import type { Item, LibraryPage, Page, SourceKind, SyncStatus, Video } from '../lib/data'
import { apiDay, bounded, fail, life, nowMs, stmt, type Bindings } from './db'

export type FeedInput = {
  channels?: string[]; playlists?: string[]; favorites?: string[]; hidden?: string[]
  q?: string; order: 'old' | 'new'; cursor?: string
}
const json = (v: string[] | undefined) => JSON.stringify(v ?? [])
export async function touchSources(env: Bindings, channels?: string[], playlists?: string[]) {
  if (!channels?.length && !playlists?.length) return
  const now = nowMs()
  await stmt(env, `UPDATE source SET seen=? WHERE seen<? AND
    ((kind='channel' AND id IN (SELECT value FROM json_each(?))) OR
    (kind='playlist' AND id IN (SELECT value FROM json_each(?))))`,
    now, now - 3600_000, json(channels), json(playlists)).run()
}

export async function statuses(env: Bindings, channels?: string[], playlists?: string[]) {
  if (!channels?.length && !playlists?.length) return []
  const now = nowMs()
  const { results } = await stmt(env, `SELECT s.kind,s.id,j.full,j.checked,j.error,j.due,
    CASE s.kind WHEN 'channel' THEN (SELECT count(*) FROM video v WHERE v.channel=s.id AND v.uploaded=1 AND v.expires>?)
      ELSE (SELECT count(*) FROM member WHERE playlist=s.id AND generation=coalesce(nullif(j.active,0),j.generation)) END AS n
    FROM source s LEFT JOIN job j USING(kind,id)
    WHERE (s.kind='channel' AND s.id IN (SELECT value FROM json_each(?)))
       OR (s.kind='playlist' AND s.id IN (SELECT value FROM json_each(?)))`, now, json(channels), json(playlists))
    .all<{ kind: SourceKind; id: string; full: number | null; checked: number; error: string | null; due: number; n: number }>()
  const budget = await stmt(env, 'SELECT blocked,api,sync FROM budget WHERE day=?', apiDay()).first<{ blocked: number; api: number; sync: number }>()
  const pause = budget?.blocked ? 'quota'
    : budget && (budget.api >= bounded(env.API_DAILY_LIMIT, 3500, 9500) || budget.sync >= bounded(env.SYNC_DAILY_LIMIT, 220, 650)) ? 'budget' : undefined
  return results.map((s): SyncStatus => ({ kind: s.kind, id: s.id, count: s.n, complete: (s.full ?? 0) > now - life, checked: s.checked ?? 0, error: s.error ?? ((s.due ?? now) <= now ? pause : undefined), due: s.due ?? now }))
}

const size = 24
export async function feed(env: Bindings, input: FeedInput): Promise<LibraryPage> {
  const { channels, playlists, favorites, hidden, order, cursor, q } = input
  if (!channels?.length && !playlists?.length && !favorites?.length) return { items: [], statuses: [] }
  const [published, id] = cursor?.split('|') ?? ['', '']
  const op = order === 'old' ? '>' : '<'
  const dir = order === 'old' ? 'ASC' : 'DESC'
  const term = q?.trim().toLowerCase() ?? ''
  const now = nowMs()
  const { results } = await stmt(env, `WITH selected(id) AS (
    SELECT id FROM video WHERE uploaded=1 AND channel IN (SELECT value FROM json_each(?))
    UNION SELECT m.video FROM job j JOIN member m ON m.playlist=j.id AND m.generation=coalesce(nullif(j.active,0),j.generation)
      WHERE j.kind='playlist' AND j.id IN (SELECT value FROM json_each(?))
    UNION SELECT value FROM json_each(?)
  )
  SELECT v.id,v.published,v.data FROM selected JOIN video v USING(id)
  WHERE expires>? AND (?='' OR (published,v.id) ${op} (?,?))
    AND v.id NOT IN (SELECT value FROM json_each(?))
    AND (?='' OR instr(lower(title),?)>0 OR instr(lower(author),?)>0)
  ORDER BY published ${dir},v.id ${dir} LIMIT ?`,
  json(channels), json(playlists), json(favorites), now, published, published, id, json(hidden), term, term, term, size + 1)
    .all<{ id: string; published: string; data: string }>()
  const last = results[size - 1]
  return {
    items: results.slice(0, size).map(row => JSON.parse(row.data) as Video),
    next: results.length > size ? `${last.published}|${last.id}` : undefined,
    statuses: await statuses(env, channels, playlists),
  }
}

type ItemRow = { item: string; position: number; video: string | null; data: string | null }
const itemRow = (row: ItemRow): Item => ({
  itemId: row.item, position: row.position, videoId: row.video, video: row.data ? JSON.parse(row.data) as Video : null,
})
export async function playlistPage(env: Bindings, id: string, after = -1, revision?: number): Promise<Page<Item>> {
  const current = await stmt(env, "SELECT coalesce(nullif(active,0),generation) AS gen FROM job WHERE kind='playlist' AND id=?", id).first<number>('gen')
  if (current == null) return { items: [] }
  if (revision !== undefined && current !== revision) fail('page')
  const { results } = await stmt(env, `SELECT m.item,m.position,m.video,v.data FROM member m
    LEFT JOIN video v ON v.id=m.video AND v.expires>? WHERE playlist=? AND generation=? AND position>?
    ORDER BY position LIMIT 31`, nowMs(), id, current, after).all<ItemRow>()
  return { items: results.slice(0, 30).map(itemRow), next: results.length > 30 ? `${current}:${results[29].position}` : undefined }
}

async function firstAtGeneration(env: Bindings, id: string, generation: number) {
  const row = await stmt(env, `SELECT m.item,m.position,m.video,v.data FROM member m JOIN video v ON v.id=m.video AND v.expires>?
    WHERE playlist=? AND generation=? AND json_extract(v.data,'$.embeddable')=1 ORDER BY position LIMIT 1`, nowMs(), id, generation).first<ItemRow>()
  return row ? itemRow(row) : undefined
}

export async function firstPlayable(env: Bindings, id: string) {
  const generation = await stmt(env, "SELECT coalesce(nullif(active,0),generation) AS gen FROM job WHERE kind='playlist' AND id=?", id).first<number>('gen')
  return generation == null ? undefined : firstAtGeneration(env, id, generation)
}

export async function queueWindow(env: Bindings, id: string, video: string, index?: number) {
  const job = await stmt(env, "SELECT coalesce(nullif(active,0),generation) AS gen,active FROM job WHERE kind='playlist' AND id=?", id)
    .first<{ gen: number; active: number }>()
  if (!job) return { items: [], complete: false }
  const { gen, active } = job
  const position = await stmt(env, `SELECT position FROM member WHERE playlist=? AND generation=? AND video=?
    ORDER BY (position=?) DESC,position LIMIT 1`, id, gen, video, (index ?? 0) - 1).first<number>('position')
  const { items, next: cursor } = await playlistPage(env, id, Math.max(-1, (position ?? 0) - 12), gen)
  const neighboring = async (op: '<' | '>', dir: 'DESC' | 'ASC') => {
    if (position == null) return undefined
    const row = await stmt(env, `SELECT m.item,m.position,m.video,v.data FROM member m
      JOIN video v ON v.id=m.video AND v.expires>? WHERE playlist=? AND generation=? AND json_extract(v.data,'$.embeddable')=1 AND position${op}?
      ORDER BY position ${dir} LIMIT 1`, nowMs(), id, gen, position).first<ItemRow>()
    return row ? itemRow(row) : undefined
  }
  const [previous, next, first] = await Promise.all([neighboring('<', 'DESC'), neighboring('>', 'ASC'),
    firstAtGeneration(env, id, gen)])
  return { items, cursor, position, previous, next, first, complete: !!active }
}
