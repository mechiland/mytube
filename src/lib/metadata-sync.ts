import type { Item, LibraryPage, Page, Playlist, Source, SourceKind, SyncStatus, Video } from './data'
import type { Library } from './library'

export type SyncKind = SourceKind | 'channel-lists' | 'video'
export type MetadataPage = LibraryPage | Page<Item> | Page<Playlist>
export type MetadataJob = {
  key: string; kind: SyncKind; id: string; phase: 'metadata' | 'pages' | 'verify'
  epoch: string; activeEpoch?: string; cursor?: string; page: number; seen: string[]
  revision?: string; complete: boolean; completedAt?: number; nextAttempt: number; failures: number; error?: string
}
export type MetadataWrite = {
  source?: { data: Source; status?: SyncStatus }; video?: Video
  page?: { collection: string; index: number; data: MetadataPage }
}
export type MetadataRequest = <T>(path: string, params?: Record<string, string | number | undefined>, signal?: AbortSignal, data?: unknown) => Promise<T>
export const metadataLifetime = 28 * 86_400_000
const day = 86_400_000
export const metadataJobKey = (kind: SyncKind, id: string) => `${kind}:${id}`

export function libraryJobs(library: Library) {
  return [
    ...library.channels.flatMap(id => [{ kind: 'channel' as const, id }, { kind: 'channel-lists' as const, id }]),
    ...library.playlists.map(id => ({ kind: 'playlist' as const, id })),
    ...[...new Set([...library.favorites, ...library.hidden, ...Object.keys(library.progress)])].map(id => ({ kind: 'video' as const, id })),
  ]
}

export function newMetadataJob(kind: SyncKind, id: string): MetadataJob {
  return { key: metadataJobKey(kind, id), kind, id, phase: kind === 'channel-lists' ? 'pages' : 'metadata',
    epoch: crypto.randomUUID(), page: 0, seen: [], complete: false, nextAttempt: 0, failures: 0 }
}

const revision = (status?: SyncStatus) => `${status?.checked ?? 0}:${status?.count ?? 0}:${status?.complete ?? false}`

// One request per step; the page and its next cursor are committed in one IndexedDB transaction.
export async function syncMetadataStep(job: MetadataJob, request: MetadataRequest,
  commit: (job: MetadataJob, data: MetadataWrite) => Promise<void>, signal: AbortSignal, now = Date.now()) {
  const save = async (next: MetadataJob, data: MetadataWrite = {}) => {
    signal.throwIfAborted()
    await commit(next, data)
  }
  try {
    if (job.kind === 'video') {
      const video = await request<Video>('video', { id: job.id }, signal)
      await save({ ...job, complete: true, completedAt: now, nextAttempt: now + day, failures: 0, error: undefined }, { video })
      return
    }
    if (job.kind !== 'channel-lists' && job.phase !== 'pages') {
      const source = await request<{ data: Source; status?: SyncStatus }>('source', { kind: job.kind, id: job.id, start: '1' }, signal)
      const current = revision(source.status)
      const unchanged = current === job.revision
      if (unchanged && (job.phase === 'verify' || (job.completedAt !== undefined && job.completedAt > now - day))) {
        await save({ ...job, phase: 'metadata', activeEpoch: job.phase === 'verify' ? job.epoch : job.activeEpoch,
          complete: source.status?.complete === true, completedAt: job.phase === 'verify' ? now : job.completedAt,
          nextAttempt: now + (source.status?.complete ? 300_000 : 60_000), failures: 0, error: undefined }, { source })
      } else {
        await save({ ...job, phase: 'pages', activeEpoch: job.phase === 'verify' ? job.activeEpoch ?? job.epoch : job.activeEpoch,
          epoch: crypto.randomUUID(), cursor: undefined, page: 0, seen: [],
          revision: current, complete: false, nextAttempt: now, failures: 0, error: undefined }, { source })
      }
      return
    }
    const page = job.kind === 'channel'
      ? await request<LibraryPage>('feed', {}, signal, { channels: [job.id], playlists: [], favorites: [], hidden: [], order: 'new', cursor: job.cursor })
      : await request<Page<Item> | Page<Playlist>>(job.kind === 'playlist' ? 'playlist' : 'channel-lists', { id: job.id, cursor: job.cursor }, signal)
    if (page.next && (page.next === job.cursor || job.seen.includes(page.next))) throw { code: 'page' }
    const next: MetadataJob = { ...job, cursor: page.next, page: job.page + 1, seen: page.next ? [...job.seen, page.next] : job.seen,
      nextAttempt: now, failures: 0, error: undefined }
    if (!page.next) {
      if (job.kind === 'channel-lists') Object.assign(next, { activeEpoch: job.epoch, epoch: crypto.randomUUID(), page: 0, seen: [], complete: true, completedAt: now, nextAttempt: now + 3600_000 })
      else next.phase = 'verify'
    }
    await save(next, { page: { collection: `${job.key}:${job.epoch}`, index: job.page, data: page } })
  } catch (error) {
    if (signal.aborted) throw error
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'network'
    const failures = job.failures + 1
    const delay = code === 'rate' ? 60_000 : ['quota', 'budget'].includes(code) ? 3600_000
      : ['configuration', 'credentials', 'missing', 'storage'].includes(code) ? 6 * 3600_000
      : Math.min(300_000, 5000 * 2 ** Math.min(failures - 1, 6))
    await save({ ...job, ...(code === 'page' ? { phase: job.kind === 'channel-lists' ? 'pages' as const : 'metadata' as const,
      epoch: crypto.randomUUID(), cursor: undefined, page: 0, seen: [], revision: undefined } : {}),
      nextAttempt: now + delay, failures, error: code })
  }
}
