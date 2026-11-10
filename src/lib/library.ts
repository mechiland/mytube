import { MessageError } from './message-error'
import { channelId, playlistId, videoId, watchSearch } from './youtube-url'

export const MAX_SOURCES = 40
export const MAX_FAVORITES = 200
export const MAX_PERSONAL = 2000
export const MAX_BACKUP_BYTES = 500_000
export type Progress = { at: number; duration: number; updatedAt: number }
export type WatchContext = { list?: string; index?: number; t?: string }
export type Library = {
  schemaVersion: 1
  channels: string[]
  playlists: string[]
  favorites: string[]
  hidden: string[]
  progress: Record<string, Progress>
  contexts: Record<string, WatchContext>
  theme: 'system' | 'light' | 'dark'
  loop: boolean
}
export const emptyLibrary = (): Library => ({
  schemaVersion: 1, channels: [], playlists: [], favorites: [], hidden: [], progress: {}, contexts: {}, theme: 'system', loop: false,
})
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const unique = (items: string[]) => Array.from(new Set(items))
const numberIn = (n: unknown, max: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max

export function validateLibrary(raw: unknown): Library {
  const invalid = () => new MessageError('backupInvalid', '备份格式、版本或数据数量无效。')
  if (!isObject(raw) || raw.schemaVersion !== 1) throw invalid()
  const list = (key: string, check: (v: unknown) => boolean, max: number): string[] => {
    const value = raw[key]
    if (!Array.isArray(value) || value.length > max || !value.every(check)) throw invalid()
    return unique(value)
  }
  const channels = list('channels', channelId, MAX_SOURCES)
  const playlists = list('playlists', playlistId, MAX_SOURCES)
  const favorites = list('favorites', videoId, MAX_FAVORITES)
  if (channels.length + playlists.length > MAX_SOURCES) throw invalid()
  if (!isObject(raw.progress) || Object.keys(raw.progress).length > MAX_PERSONAL) throw invalid()
  const progress: Library['progress'] = {}
  for (const [id, value] of Object.entries(raw.progress)) {
    if (!videoId(id) || !isObject(value) || !numberIn(value.at, 604800) || !numberIn(value.duration, 604800)
      || !numberIn(value.updatedAt, 8.64e15) || value.at > value.duration) throw invalid()
    progress[id] = { at: value.at, duration: value.duration, updatedAt: value.updatedAt }
  }
  const contexts: Library['contexts'] = {}
  if (raw.contexts !== undefined) {
    if (!isObject(raw.contexts) || Object.keys(raw.contexts).length > MAX_FAVORITES) throw invalid()
    for (const [id, value] of Object.entries(raw.contexts)) {
      if (!favorites.includes(id) || !isObject(value)) throw invalid()
      const { v: _id, ...context } = watchSearch(value)
      contexts[id] = context
    }
  }
  if (raw.theme !== 'light' && raw.theme !== 'dark' && raw.theme !== 'system') throw invalid()
  if (typeof raw.loop !== 'boolean') throw invalid()
  return { schemaVersion: 1, channels, playlists, favorites, hidden: list('hidden', videoId, MAX_PERSONAL), progress, contexts, theme: raw.theme, loop: raw.loop }
}
export function parseBackup(text: string) {
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw new MessageError('backupTooLarge', '备份文件超过 500 KB。')
  return validateLibrary(JSON.parse(text))
}
export function mergeLibrary(local: Library, incoming: Library) {
  const progress = { ...local.progress }
  for (const [id, value] of Object.entries(incoming.progress)) {
    if (!progress[id] || progress[id].updatedAt < value.updatedAt) progress[id] = value
  }
  return validateLibrary({
    ...local, progress, contexts: { ...incoming.contexts, ...local.contexts },
    channels: unique([...local.channels, ...incoming.channels]), playlists: unique([...local.playlists, ...incoming.playlists]),
    favorites: unique([...local.favorites, ...incoming.favorites]), hidden: unique([...local.hidden, ...incoming.hidden]),
  })
}
