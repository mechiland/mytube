import type { Source, SourceKind, Video } from '../lib/data'
import { ApiError, apiDay, bounded, charge, dayMs, fail, life, nowMs, stmt, type Bindings } from './db'
import { getChannel, getItems, getPlaylist, getVideos } from './youtube'

const activity = 30 * dayMs
const metadataInterval = dayMs
const interval = (env: Bindings) => bounded(env.SYNC_INTERVAL_SECONDS, 21600, 86400) * 1000
export type Job = {
  kind: SourceKind; id: string; due: number; token: string | null; generation: number; active: number;
  full: number; checked: number; last_manual: number; lease: string; failures: number; error: string | null
}

export function storeSource(env: Bindings, source: Source, now = nowMs()) {
  return stmt(env, `INSERT INTO source(kind,id,data,alias,uploads,expires,seen) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data,alias=excluded.alias,uploads=excluded.uploads,expires=excluded.expires`,
    source.kind, source.id, JSON.stringify(source), source.kind === 'channel' ? source.handle?.toLowerCase() ?? null : null,
    source.kind === 'channel' ? source.uploads : source.id, now + life, now)
}
export async function enroll(env: Bindings, source: Source, fresh = true) {
  const now = nowMs()
  await env.DB.batch([
    ...(fresh ? [storeSource(env, source, now)] : []),
    stmt(env, 'UPDATE source SET seen=? WHERE kind=? AND id=? AND seen<?', now, source.kind, source.id, now - 3600_000),
    stmt(env, 'INSERT OR IGNORE INTO job(kind,id,due,generation) VALUES(?,?,?,?)', source.kind, source.id, now, now),
  ])
}

const leaseGuard = 'EXISTS(SELECT 1 FROM job WHERE kind=? AND id=? AND lease=?)'
export function storeVideos(env: Bindings, videos: Video[], expires: number, job?: Job) {
  const rows = videos.map(video => [
    video.id, video.channelId, video.published, video.title.toLowerCase(), video.channelTitle.toLowerCase(), JSON.stringify(video),
    +(job?.kind === 'channel' && video.public === true && video.channelId === job.id),
  ])
  return stmt(env, `INSERT INTO video(id,channel,published,title,author,data,expires,uploaded)
    SELECT value->>0,value->>1,value->>2,value->>3,value->>4,value->>5,?,value->>6
    FROM json_each(?) WHERE ${job ? leaseGuard : '1'}
    ON CONFLICT(id) DO UPDATE SET channel=excluded.channel,published=excluded.published,title=excluded.title,author=excluded.author,
    data=excluded.data,expires=excluded.expires,
    uploaded=CASE WHEN excluded.uploaded=1 THEN 1 WHEN json_extract(excluded.data,'$.public')=0 THEN 0 ELSE video.uploaded END`,
    expires, JSON.stringify(rows), ...(job ? [job.kind, job.id, job.lease] : []))
}

export async function runSource(env: Bindings, kind?: SourceKind, id?: string) {
  const now = nowMs()
  const lease = crypto.randomUUID()
  const target = kind && id ? 'AND job.kind=? AND job.id=?' : ''
  const job = await stmt(env, `UPDATE job SET lease=?,lease_until=?
    WHERE (kind,id)=(SELECT job.kind,job.id FROM job JOIN source s USING(kind,id)
      WHERE job.due<=? AND job.lease_until<=? AND s.seen>? ${target} ORDER BY job.due LIMIT 1)
    RETURNING *`, lease, now + 45_000, now, now, now - activity, ...(kind && id ? [kind, id] : [])).first<Job>()
  if (!job) return
  const scope = [job.kind, job.id, lease] as const
  const finish = (sql: string, ...args: (string | number | null)[]) =>
    stmt(env, `UPDATE job SET ${sql},lease=NULL,lease_until=0 WHERE kind=? AND id=? AND lease=?`, ...args, ...scope)

  try {
    await charge(env, 'sync')
    const source = await stmt(env, 'SELECT uploads,expires FROM source WHERE kind=? AND id=?', job.kind, job.id)
      .first<{ uploads: string; expires: number }>()
    if (!source) return
    let uploads = source.uploads
    if (!job.token && source.expires < now + life - metadataInterval) {
      const fresh = job.kind === 'channel' ? await getChannel(env, { id: job.id }) : await getPlaylist(env, job.id)
      uploads = fresh.kind === 'channel' ? fresh.uploads : fresh.id
      await storeSource(env, fresh, now).run()
    }

    const { items, next } = await getItems(env, uploads, job.token)
    const ids = [...new Set(items.flatMap(item => item.videoId ? [item.videoId] : []))]
    const scanAll = job.kind === 'playlist' || job.full < now - 20 * dayMs
    const known = !scanAll && ids.length ? await stmt(env,
      'SELECT count(*) AS n FROM video WHERE channel=? AND uploaded=1 AND expires>? AND id IN (SELECT value FROM json_each(?))',
      job.id, now, JSON.stringify(ids)).first<number>('n') : 0
    const videos = await getVideos(env, ids)
    const visible = new Set(videos.map(v => v.id))
    const done = !next || (!scanAll && known === ids.length)
    // Prevent an expired worker from committing over a successor. D1 batches are atomic.
    const writes: D1PreparedStatement[] = [stmt(env, `UPDATE job SET lease_until=? WHERE kind=? AND id=? AND lease=? RETURNING lease`,
      nowMs() + 45_000, ...scope)]
    const current = await writes[0].first<string>('lease')
    if (current !== lease) return
    writes.length = 0
    if (videos.length) writes.push(storeVideos(env, videos, now + life, job))
    const inaccessible = ids.filter(v => !visible.has(v))
    if (inaccessible.length) writes.push(stmt(env, `DELETE FROM video WHERE id IN (SELECT value FROM json_each(?)) AND ${leaseGuard}`, JSON.stringify(inaccessible), ...scope))
    if (job.kind === 'playlist' && items.length) {
      writes.push(stmt(env, `INSERT INTO member(playlist,generation,position,item,video)
        SELECT ?,?,value->>'position',value->>'itemId',value->>'videoId' FROM json_each(?) WHERE ${leaseGuard}`,
      job.id, job.generation, JSON.stringify(items), ...scope))
    }
    writes.push(finish(`token=?,due=?,full=?,checked=?,active=?,generation=?,failures=0,error=NULL`,
      done ? null : next ?? null, now + (done ? interval(env) : 30_000),
      done && scanAll ? now : job.full, now,
      done && job.kind === 'playlist' ? job.generation : job.active,
      done ? job.generation + 1 : job.generation))
    await env.DB.batch(writes)
  } catch (error) {
    const code = error instanceof ApiError ? error.code : 'service'
    const invalidScan = code === 'page' || (job.kind === 'playlist' && error instanceof Error && /UNIQUE constraint failed: member/.test(error.message))
    const failures = job.failures + 1
    const delay = code === 'quota' || code === 'budget' ? 3600_000
      : ['configuration', 'credentials', 'missing', 'storage'].includes(code) ? 6 * 3600_000
      : Math.min(6 * 3600_000, 60_000 * 2 ** Math.min(failures - 1, 9))
    await finish('due=?,failures=?,error=?,token=?,generation=?,full=?', now + delay, failures, code,
      invalidScan ? null : job.token, job.generation + +invalidScan, invalidScan && job.kind === 'channel' ? 0 : job.full).run()
  }
}

export async function refreshSource(env: Bindings, kind: SourceKind, id: string) {
  const now = nowMs()
  const job = await stmt(env, `UPDATE job SET last_manual=?,due=? WHERE kind=? AND id=? AND last_manual<? AND lease_until<=?
    RETURNING id`, now, now, kind, id, now - 5 * 60_000, now).first()
  if (!job) fail('busy', 409)
  await runSource(env, kind, id)
}

export async function runScheduled(env: Bindings) {
  const now = nowMs()
  const minute = Math.floor(now / 60_000)
  // Bounded cleanup in alternating runs. Members of the current or incomplete snapshot survive.
  if (minute % 5 === 0) await env.DB.batch([
    stmt(env, 'DELETE FROM response_cache WHERE key IN (SELECT key FROM response_cache WHERE expires<=? LIMIT 40)', now),
    stmt(env, 'DELETE FROM video WHERE id IN (SELECT id FROM video WHERE expires<=? LIMIT 36)', now),
    stmt(env, 'DELETE FROM source WHERE (kind,id) IN (SELECT kind,id FROM source WHERE expires<=? LIMIT 10)', now),
    stmt(env, 'DELETE FROM lookup_lease WHERE key IN (SELECT key FROM lookup_lease WHERE expires<=? LIMIT 30)', now),
    stmt(env, `UPDATE job SET active=0,full=0 WHERE (kind,id) IN
      (SELECT kind,id FROM job WHERE kind='playlist' AND active>0 AND full<=? ORDER BY full LIMIT 4)`, now - life),
    stmt(env, 'DELETE FROM budget WHERE day<?', apiDay(now - 3 * dayMs)),
  ])
  if (minute % 5 === 1) {
    const retired = await env.DB.prepare('SELECT playlist,generation FROM retired_member LIMIT 1')
      .first<{ playlist: string; generation: number }>()
    if (retired) {
      const { playlist, generation } = retired
      await env.DB.batch([
        stmt(env, `DELETE FROM member WHERE playlist=? AND generation=? AND position IN
          (SELECT position FROM member WHERE playlist=? AND generation=? ORDER BY position LIMIT 48)`, playlist, generation, playlist, generation),
        stmt(env, `DELETE FROM retired_member WHERE playlist=? AND generation=? AND NOT EXISTS
          (SELECT 1 FROM member WHERE playlist=? AND generation=? LIMIT 1)`, playlist, generation, playlist, generation),
      ])
    }
  }
  const state = await stmt(env, 'SELECT api,sync,blocked FROM budget WHERE day=?', apiDay()).first<{ api: number; sync: number; blocked: number }>()
  if (state && (state.blocked || state.api >= bounded(env.API_DAILY_LIMIT, 3500, 9500) || state.sync >= bounded(env.SYNC_DAILY_LIMIT, 220, 650))) return
  await runSource(env)
}
