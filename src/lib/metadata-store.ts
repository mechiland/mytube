import { openDB, type DBSchema } from 'idb'
import type { Item, LibraryPage, Page, Source, SyncStatus, Video } from './data'
import { metadataJobKey, metadataLifetime, newMetadataJob, type MetadataJob, type MetadataPage, type MetadataWrite, type SyncKind } from './metadata-sync'

type SourceRecord = { data: Source; status?: SyncStatus; alias?: string; updatedAt: number }
interface MetadataDB extends DBSchema {
  sources: { key: string; value: SourceRecord; indexes: { alias: string; updatedAt: number } }
  videos: { key: string; value: { data: Video; updatedAt: number }; indexes: { updatedAt: number } }
  pages: { key: [string, number]; value: { collection: string; index: number; data: MetadataPage; updatedAt: number }; indexes: { collection: string; updatedAt: number } }
  jobs: { key: string; value: MetadataJob; indexes: { nextAttempt: number } }
  leases: { key: string; value: { owner: string; until: number } }
}
let connection: ReturnType<typeof openDB<MetadataDB>> | undefined
export const metadataDatabase = () => connection ??= openDB<MetadataDB>('mytube-library', 1, {
  upgrade(db) {
    const sources = db.createObjectStore('sources')
    sources.createIndex('alias', 'alias')
    sources.createIndex('updatedAt', 'updatedAt')
    db.createObjectStore('videos').createIndex('updatedAt', 'updatedAt')
    const pages = db.createObjectStore('pages')
    pages.createIndex('collection', 'collection')
    pages.createIndex('updatedAt', 'updatedAt')
    db.createObjectStore('jobs').createIndex('nextAttempt', 'nextAttempt')
    db.createObjectStore('leases')
  },
  blocking: () => { void connection?.then(db => db.close()); connection = undefined },
  terminated: () => { connection = undefined },
}).catch((error: unknown) => { connection = undefined; throw error })

function records(data: unknown, sources = new Map<string, SourceRecord>(), videos = new Map<string, Video>()) {
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(visit); return }
    const object = value as Record<string, unknown>
    if (object.kind === 'video' && typeof object.title === 'string') { videos.set(String(object.id), value as Video); return }
    if ((object.kind === 'channel' || object.kind === 'playlist') && typeof object.title === 'string') {
      const source = value as Source
      sources.set(metadataJobKey(source.kind, source.id), { data: source, alias: source.kind === 'channel' ? source.handle?.toLowerCase() : undefined, updatedAt: Date.now() })
      return
    }
    if (object.data && typeof object.data === 'object' && 'kind' in object.data) {
      visit(object.data)
      const source = object.data as Source
      const stored = sources.get(metadataJobKey(source.kind, source.id))
      if (stored && object.status) stored.status = object.status as SyncStatus
    }
    for (const key of ['items', 'pages', 'value', 'video', 'previous', 'next', 'first']) visit(object[key])
  }
  visit(data)
  return { sources, videos }
}

export async function recordMetadata(data: unknown) {
  const { sources, videos } = records(data)
  if (!sources.size && !videos.size) return
  const db = await metadataDatabase()
  const tx = db.transaction(['sources', 'videos'], 'readwrite')
  for (const [key, value] of sources) {
    const previous = await tx.objectStore('sources').get(key)
    await tx.objectStore('sources').put({ ...value, status: value.status ?? previous?.status }, key)
  }
  for (const [key, data] of videos) await tx.objectStore('videos').put({ data, updatedAt: Date.now() }, key)
  await tx.done
}

export async function ensureMetadataJobs(entries: { kind: SyncKind; id: string }[]) {
  const db = await metadataDatabase()
  const tx = db.transaction('jobs', 'readwrite')
  const keys = new Set(entries.map(entry => metadataJobKey(entry.kind, entry.id)))
  for (const key of await tx.store.getAllKeys()) if (!keys.has(key)) await tx.store.delete(key)
  for (const { kind, id } of entries) {
    const key = metadataJobKey(kind, id)
    if (!await tx.store.get(key)) await tx.store.put(newMetadataJob(kind, id), key)
  }
  await tx.done
  // The complete library has no record-count cap; only expired metadata is removed.
  for (const name of ['sources', 'videos', 'pages'] as const) {
    const cleanup = db.transaction(name, 'readwrite')
    for await (const cursor of cleanup.store.index('updatedAt').iterate(IDBKeyRange.upperBound(Date.now() - metadataLifetime))) await cursor.delete()
    await cleanup.done
  }
}

export async function commitMetadataStep(job: MetadataJob, write: MetadataWrite, expected?: MetadataJob) {
  const db = await metadataDatabase()
  const { sources, videos } = records(write.source ?? write.video ?? write.page?.data)
  const tx = db.transaction(['jobs', 'sources', 'videos', 'pages', 'leases'], 'readwrite')
  // Removing a subscription during a request must not resurrect its sync job.
  const current = await tx.objectStore('jobs').get(job.key)
  if (!current || (expected && (current.epoch !== expected.epoch || current.page !== expected.page || current.phase !== expected.phase))) { await tx.done; return }
  for (const [key, value] of sources) {
    const previous = await tx.objectStore('sources').get(key)
    await tx.objectStore('sources').put({ ...value, status: value.status ?? previous?.status }, key)
  }
  for (const [key, data] of videos) await tx.objectStore('videos').put({ data, updatedAt: Date.now() }, key)
  if (write.page) await tx.objectStore('pages').put({ ...write.page, updatedAt: Date.now() }, [write.page.collection, write.page.index])
  await tx.objectStore('jobs').put(job, job.key)
  if (job.error === 'rate') await tx.objectStore('leases').put({ owner: 'api', until: job.nextAttempt }, 'cooldown')
  if (job.activeEpoch && job.activeEpoch !== current.activeEpoch) {
    for await (const cursor of tx.objectStore('pages').iterate(IDBKeyRange.bound([`${job.key}:`, 0], [`${job.key};`, 0], false, true))) {
      if (![`${job.key}:${job.activeEpoch}`, `${job.key}:${job.epoch}`].includes(cursor.value.collection)) await cursor.delete()
    }
  }
  await tx.done
}

export async function refreshLocalSource(status: SyncStatus) {
  const db = await metadataDatabase()
  const key = metadataJobKey(status.kind, status.id)
  const tx = db.transaction(['sources', 'jobs'], 'readwrite')
  const source = await tx.objectStore('sources').get(key)
  if (source) await tx.objectStore('sources').put({ ...source, status }, key)
  const job = await tx.objectStore('jobs').get(key)
  if (job) await tx.objectStore('jobs').put({ ...job, phase: 'metadata', epoch: crypto.randomUUID(), revision: undefined, cursor: undefined, page: 0, seen: [], nextAttempt: 0 }, key)
  await tx.done
}

async function archive(kind: SyncKind, id: string, includeStaging = false) {
  const db = await metadataDatabase()
  const job = await db.get('jobs', metadataJobKey(kind, id))
  if (!job) return undefined
  const epochs = includeStaging ? [...new Set([job.activeEpoch, job.epoch].filter(Boolean))] : [job.activeEpoch ?? job.epoch]
  const pages = (await Promise.all(epochs.map(epoch => db.getAllFromIndex('pages', 'collection', `${job.key}:${epoch}`)))).flat()
    .filter(page => page.updatedAt > Date.now() - metadataLifetime)
  if (!pages.length && (!job.complete || !job.completedAt || job.completedAt <= Date.now() - metadataLifetime)) return undefined
  return { job, pages }
}

type FeedInput = { channels?: string[]; playlists?: string[]; favorites?: string[]; hidden?: string[]; q?: string; order?: string; cursor?: string }
async function localFeed(input: FeedInput): Promise<LibraryPage | undefined> {
  const db = await metadataDatabase()
  const videos = new Map<string, Video>()
  const statuses: SyncStatus[] = []
  let available = false
  for (const [kind, ids] of [['channel', input.channels], ['playlist', input.playlists]] as const) {
    for (const id of ids ?? []) {
      const local = await archive(kind, id, kind === 'channel')
      if (!local) continue
      available = true
      const source = await db.get('sources', metadataJobKey(kind, id))
      if (source?.status) statuses.push(source.status)
      for (const page of local.pages) for (const item of page.data.items) {
        const video = 'kind' in item && item.kind === 'video' ? item as Video : 'video' in item ? item.video : null
        if (video) videos.set(video.id, video)
      }
    }
  }
  for (const id of input.favorites ?? []) {
    const row = await db.get('videos', id)
    if (row && row.updatedAt > Date.now() - metadataLifetime) { available = true; videos.set(id, row.data) }
  }
  if (!available) return undefined
  const hidden = new Set(input.hidden)
  const term = input.q?.trim().toLowerCase() ?? ''
  const old = input.order === 'old'
  const [published, id] = input.cursor?.split('|') ?? ['', '']
  const cursor = published + id
  const items = [...videos.values()].filter(video => !hidden.has(video.id)
    && (!term || video.title.toLowerCase().includes(term) || video.channelTitle.toLowerCase().includes(term))
    && (!cursor || (old ? video.published + video.id > cursor : video.published + video.id < cursor)))
    .sort((a, b) => (a.published + a.id < b.published + b.id ? -1 : a.published + a.id > b.published + b.id ? 1 : 0) * (old ? 1 : -1))
  const last = items[23]
  return { items: items.slice(0, 24), next: items.length > 24 ? `${last.published}|${last.id}` : undefined, statuses }
}

async function playlistRows(id: string) {
  const local = await archive('playlist', id)
  if (!local) return undefined
  const items = local.pages.flatMap(page => (page.data as Page<Item>).items).sort((a, b) => a.position - b.position)
  return { ...local, items, epoch: local.job.activeEpoch ?? local.job.epoch }
}

export async function readLocalMetadata(path: string, params: Record<string, string | number | undefined>, body?: unknown): Promise<unknown> {
  if (!['source', 'video', 'feed', 'playlist', 'playlist-first', 'channel-lists', 'queue'].includes(path)) return undefined
  const db = await metadataDatabase()
  const id = String(params.id ?? '')
  const cursor = String(params.cursor ?? '')
  if (path === 'source') {
    const source = id ? await db.get('sources', `${params.kind}:${id}`) : await db.getFromIndex('sources', 'alias', String(params.handle).toLowerCase())
    return source && source.updatedAt > Date.now() - metadataLifetime && (source.status || params.start !== '1') ? { data: source.data, status: source.status } : undefined
  }
  if (path === 'video') {
    const video = await db.get('videos', id)
    return video && video.updatedAt > Date.now() - metadataLifetime ? video.data : undefined
  }
  if (path === 'feed') return body ? localFeed(body as FeedInput) : undefined
  if (path === 'channel-lists') {
    const local = await archive('channel-lists', id)
    if (!local) return undefined
    const epoch = local.job.activeEpoch ?? local.job.epoch
    const index = cursor.startsWith(`local:${epoch}:`) ? Number(cursor.split(':').at(-1)) : cursor ? -1 : 0
    if (index < 0) return undefined
    const page = local.pages[index]
    return page ? { items: page.data.items, next: index + 1 < local.pages.length ? `local:${local.job.activeEpoch ?? local.job.epoch}:${index + 1}` : undefined } : { items: [] }
  }
  const local = await playlistRows(id)
  if (!local) return undefined
  const pageAt = (after: number) => {
    const items = local.items.filter(item => item.position > after)
    return { items: items.slice(0, 30), next: items.length > 30 ? `local:${local.epoch}:${items[29].position}` : undefined }
  }
  if (path === 'playlist') {
    if (cursor && !cursor.startsWith(`local:${local.epoch}:`)) return undefined
    return pageAt(cursor ? Number(cursor.split(':').at(-1)) : -1)
  }
  const playable = local.items.filter(item => item.video?.embeddable)
  if (path === 'playlist-first') return playable[0] ?? (local.job.complete ? null : undefined)
  const matching = local.items.filter(item => item.videoId === params.v)
  const current = matching.find(item => item.position === Number(params.index) - 1) ?? matching[0]
  const page = pageAt(Math.max(-1, (current?.position ?? 0) - 12))
  return { items: page.items, cursor: page.next, position: current?.position, first: playable[0], complete: local.job.complete,
    previous: current ? playable.filter(item => item.position < current.position).at(-1) : undefined,
    next: current ? playable.find(item => item.position > current.position) : undefined }
}
