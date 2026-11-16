import { dehydrate, hydrate, type DehydratedState, type Query, type QueryClient } from '@tanstack/react-query'
import { openDB, type DBSchema } from 'idb'
import { sourceQuery, videoQuery } from './client'
import type { Item, LibraryPage, Page, Source, SyncStatus, Video } from './data'

type Snapshot = DehydratedState['queries'][number]
interface MetadataDB extends DBSchema {
  queries: { key: string; value: { updatedAt: number; query: Snapshot }; indexes: { updatedAt: number } }
}
const maxAge = 28 * 86_400_000
const maxEntries = 3000
const persistentKeys = new Set(['source', 'video', 'feed', 'playlist', 'channel-lists', 'queue'])
let connection: ReturnType<typeof openDB<MetadataDB>> | undefined
const database = () => connection ??= openDB<MetadataDB>('mytube-metadata', 1, {
  upgrade(db) { db.createObjectStore('queries').createIndex('updatedAt', 'updatedAt') },
  terminated: () => { connection = undefined },
}).catch((error: unknown) => { connection = undefined; throw error })

async function prune() {
  const db = await database()
  const tx = db.transaction('queries', 'readwrite')
  let excess = Math.max(0, await tx.store.count() - maxEntries)
  for await (const cursor of tx.store.index('updatedAt').iterate()) {
    if (cursor.value.updatedAt > Date.now() - maxAge && excess <= 0) break
    await cursor.delete()
    excess--
  }
  await tx.done
}

export async function restoreQueryCache(client: QueryClient) {
  await prune()
  const rows = await (await database()).getAll('queries')
  hydrate(client, { mutations: [], queries: rows.map(row => row.query).filter(query =>
    // Fresh SSR data takes precedence over a browser snapshot, even for a stale sync status.
    client.getQueryData(query.queryKey) === undefined,
  ) })
}

// Feed and playlist responses already contain full videos. Reuse them on /watch.
export function cacheMetadata(client: QueryClient, data: unknown, updatedAt = Date.now(), start = false) {
  if (!data || typeof data !== 'object') return
  if (Array.isArray(data)) {
    data.forEach(value => cacheMetadata(client, value, updatedAt, start))
    return
  }
  const value = data as Record<string, unknown>
  const seed = (queryKey: readonly unknown[], metadata: unknown) => {
    if ((client.getQueryState(queryKey)?.dataUpdatedAt ?? 0) < updatedAt) client.setQueryData(queryKey, metadata, { updatedAt })
  }
  if (value.kind === 'video') {
    const video = data as Video
    seed(videoQuery(video.id).queryKey, video)
    return
  }
  if (value.kind === 'channel' || value.kind === 'playlist') {
    const source = data as Source
    seed(sourceQuery(source.kind, source.id, undefined, false).queryKey, { data: source })
    // Display known metadata immediately; the start query still enrolls this source.
    const key = sourceQuery(source.kind, source.id).queryKey
    if (client.getQueryData(key) === undefined) client.setQueryData(key, { data: source }, { updatedAt: updatedAt - 120_000 })
    return
  }
  if (value.data && typeof value.data === 'object' && 'kind' in value.data) {
    const source = value.data as Source
    if (source.kind === 'channel' || source.kind === 'playlist') {
      const snapshot = { data: source, status: value.status as SyncStatus | undefined }
      seed(sourceQuery(source.kind, source.id, undefined, false).queryKey, snapshot)
      if (start) seed(sourceQuery(source.kind, source.id).queryKey, snapshot)
    }
  }
  for (const key of ['items', 'pages', 'video', 'previous', 'next', 'first']) {
    cacheMetadata(client, value[key], updatedAt, start)
  }
}

type FeedSelection = { channels: string[]; playlists: string[]; favorites: string[]; hidden: string[]; q?: string; order: string }
export function cachedFeed(client: QueryClient, input: FeedSelection): { pages: LibraryPage[]; pageParams: undefined[] } | undefined {
  const selected = new Set(input.favorites)
  for (const query of client.getQueryCache().findAll({ queryKey: ['playlist'] })) {
    if (!input.playlists.includes(String(query.queryKey[1]))) continue
    const data = query.state.data as { pages: Page<Item>[] } | undefined
    for (const item of data?.pages.flatMap(page => page.items) ?? []) if (item.videoId) selected.add(item.videoId)
  }
  for (const query of client.getQueryCache().findAll({ queryKey: ['feed'] })) {
    const previous = query.queryKey[1] as FeedSelection
    if (!previous.channels.every(id => input.channels.includes(id)) || !previous.playlists.every(id => input.playlists.includes(id))
      || !previous.favorites.every(id => input.favorites.includes(id))) continue
    const data = query.state.data as { pages: LibraryPage[] } | undefined
    data?.pages.forEach(page => page.items.forEach(video => selected.add(video.id)))
  }
  const term = input.q?.trim().toLowerCase() ?? ''
  const videos = client.getQueryCache().findAll({ queryKey: ['video'] }).flatMap(query => {
    const video = query.state.data as Video | undefined
    return video && (selected.has(video.id) || (input.channels.includes(video.channelId) && video.public !== false))
      && !input.hidden.includes(video.id) && (!term || video.title.toLowerCase().includes(term) || video.channelTitle.toLowerCase().includes(term)) ? [video] : []
  }).sort((a, b) => {
    const first = a.published + a.id
    const second = b.published + b.id
    return (first < second ? -1 : first > second ? 1 : 0) * (input.order === 'old' ? 1 : -1)
  })
  if (!videos.length) return undefined
  const statuses = [...input.channels.map(id => sourceQuery('channel', id)), ...input.playlists.map(id => sourceQuery('playlist', id))]
    .flatMap(query => {
      const data = client.getQueryData<{ status?: SyncStatus }>(query.queryKey)
      return data?.status ? [data.status] : []
    })
  return { pages: [{ items: videos.slice(0, 24), statuses } satisfies LibraryPage], pageParams: [undefined] }
}

export function persistQueryCache(client: QueryClient) {
  let writes = 0
  const save = (query: Query) => {
    if (!persistentKeys.has(String(query.queryKey[0])) || query.state.status !== 'success') return
    const snapshot = dehydrate(client, { shouldDehydrateQuery: value => value === query }).queries[0]
    if (!snapshot) return
    const updatedAt = query.state.dataUpdatedAt
    void database().then(db => db.put('queries', { updatedAt, query: snapshot }, query.queryHash))
      .then(() => { if (++writes % 100 === 0) return prune() }).catch(() => { /* Metadata can be fetched again if storage is unavailable. */ })
    cacheMetadata(client, query.state.data, updatedAt, query.queryKey[0] === 'source' && query.queryKey[4] === true)
  }
  const unsubscribe = client.getQueryCache().subscribe(event => {
    if (event.type === 'updated' && event.action.type === 'success') save(event.query)
  })
  client.getQueryCache().getAll().forEach(save)
  return unsubscribe
}
