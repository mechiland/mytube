import { MessageError } from './message-error'
export const videoId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{11}$/.test(v)
export const channelId = (v: unknown): v is string => typeof v === 'string' && /^UC[\w-]{22}$/.test(v)
export const playlistId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{8,100}$/.test(v)
export const handle = (v: unknown): v is string => typeof v === 'string' && /^@[\p{L}\p{M}\p{N}_.·-]{1,40}$/u.test(v)
export type Target = { kind: 'channel'; id?: string; handle?: string }
  | { kind: 'video'; id: string; time?: number; list?: string; index?: number }
  | { kind: 'playlist'; id: string }

export function timeSeconds(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const raw = String(value)
  if (raw.length > 18) return undefined
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(raw)
  if (!raw || !match) return undefined
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)
  return seconds <= 604800 ? seconds : undefined
}

export function watchSearch(s: Record<string, unknown>) {
  const index = typeof s.index === 'number' || typeof s.index === 'string' ? Number(s.index) : 0
  const t = timeSeconds(s.t)
  const list = playlistId(s.list) ? s.list : undefined
  return {
    v: videoId(s.v) ? s.v : undefined,
    ...(list ? { list } : {}),
    ...(list && Number.isSafeInteger(index) && index >= 1 && index <= 100_000 ? { index } : {}),
    ...(t !== undefined ? { t: `${t}s` } : {}),
  }
}

export function parseYouTube(input: string): Target {
  const raw = input.trim()
  if (!raw || raw.length > 2048 || /[\x00-\x20\\]/.test(raw)) throw new MessageError('invalidYouTubeLink', '请输入有效的 YouTube 链接。')
  let url: URL
  try { url = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`) }
  catch { throw new MessageError('invalidYouTubeLink', '请输入有效的 YouTube 链接。') }
  const hosts = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be']
  if (!hosts.includes(url.hostname) || !['http:', 'https:'].includes(url.protocol) || url.port || url.username || url.password)
    throw new MessageError('officialYouTubeOnly', '只支持官方 YouTube 链接。')

  const parts = url.pathname.split('/').slice(1).map(decodeURIComponent)
  if (parts.at(-1) === '') parts.pop()
  const [first, second] = parts
  const q = url.searchParams
  const list = q.get('list')
  const shortHost = url.hostname.endsWith('youtu.be')
  if (!shortHost && parts.length === 1 && first === 'playlist' && playlistId(list)) return { kind: 'playlist', id: list }
  if (!shortHost && (parts.length === 1 || (parts.length === 2 && ['videos', 'playlists', 'featured', 'about', 'shorts', 'streams'].includes(second))) && handle(first))
    return { kind: 'channel', handle: first }
  if (!shortHost && (parts.length === 2 || (parts.length === 3 && ['videos', 'playlists', 'featured', 'about', 'shorts', 'streams'].includes(parts[2]))) && first === 'channel' && channelId(second))
    return { kind: 'channel', id: second }
  if (!shortHost && (first === 'c' || first === 'user')) throw new MessageError('legacyYouTubeLink', '旧式自定义链接无法确定频道。请使用 @handle 或 /channel/UC… 链接。')

  const v = shortHost && parts.length === 1 ? first
    : !shortHost && first === 'watch' && parts.length === 1 ? q.get('v')
    : !shortHost && parts.length === 2 && ['shorts', 'live'].includes(first) ? second : null
  if (!videoId(v)) throw new MessageError('unrecognizedYouTubeLink', '链接中没有可识别的频道、视频或公开播放列表。')
  const search = watchSearch({ v, list, index: q.get('index'), t: q.get('t') ?? q.get('start') ?? new URLSearchParams(url.hash.slice(1)).get('t') })
  const time = timeSeconds(search.t)
  return { kind: 'video', id: v, ...(time === undefined ? {} : { time }), ...(search.list ? { list: search.list } : {}), ...(search.index ? { index: search.index } : {}) }
}

export function playlistSelection<T extends { videoId: string | null; position: number }>(rows: T[], v: string, index?: number) {
  return rows.find(row => row.videoId === v && row.position + 1 === index) ?? rows.find(row => row.videoId === v)
}
