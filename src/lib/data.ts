export type SourceKind = 'channel' | 'playlist'
export type Channel = {
  kind: 'channel'; id: string; title: string; thumbnail: string; description: string
  handle?: string; banner?: string; uploads: string
}
export type Playlist = {
  kind: 'playlist'; id: string; title: string; thumbnail: string; description: string
  channelId: string; channelTitle: string; count: number
}
export type Source = Channel | Playlist
export type Video = {
  kind: 'video'; id: string; title: string; description: string; thumbnail: string
  channelId: string; channelTitle: string; published: string; duration: number
  embeddable: boolean; public?: boolean; region?: { allowed?: string[]; blocked?: string[] }
}
export type Item = { itemId: string; position: number; videoId: string | null; video: Video | null }
export type Comment = { id: string; author: string; channelId?: string; text: string; published: string; likes: number; replies: number }
export type Page<T> = { items: T[]; next?: string }
export type SyncStatus = { kind: SourceKind; id: string; count: number; complete: boolean; checked: number; error?: string; due: number }
export type LibraryPage = Page<Video> & { statuses: SyncStatus[] }
export const errors: Record<string, string> = {
  input: '请求参数无效。', configuration: '服务尚未配置 YouTube API 密钥。', credentials: 'YouTube API 密钥无效、受到限制或服务未启用。',
  quota: 'YouTube 今日配额已用完，配额重置后会继续同步。', budget: '应用今日同步预算已用完，将在下一预算周期继续。',
  storage: '公共缓存已接近容量上限，已暂停写入。', network: '暂时无法连接 YouTube，请稍后重试。',
  missing: '资源不存在、已删除或不公开。', commentsDisabled: '此视频已关闭评论。', commentsUnavailable: '此视频的评论已不可用。',
  rate: '请求过于频繁，请稍后再试。', busy: '来源正在同步，请稍后重试。', page: '分页已失效，请刷新重试。',
  service: '服务暂时不可用，请稍后重试。',
}
