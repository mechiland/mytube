import { type Channel, type Playlist, type Video, type Comment, type Page } from '../lib/data'
import { channelId, handle, timeSeconds, videoId } from '../lib/youtube-url'
import { apiDay, charge, fail, stmt, type Bindings } from './db'

type Thumbnail = { url?: string }
type Snippet = {
  title: string; description?: string; channelId: string; channelTitle: string; publishedAt: string
  customUrl?: string; thumbnails?: Record<string, Thumbnail>; position?: number; resourceId?: { videoId?: string }
}
type YTItem = {
  id: string; snippet: Snippet; brandingSettings?: { image?: { bannerExternalUrl?: string } }
  contentDetails?: { relatedPlaylists?: { uploads: string }; itemCount?: number; duration?: string; videoId?: string; regionRestriction?: Video['region'] }
  status?: { privacyStatus?: string; embeddable?: boolean }
}
type UpstreamComment = {
  id: string; snippet: { authorDisplayName: string; authorChannelId?: { value?: string }; textDisplay: string; publishedAt: string; likeCount: number }
}
type Thread = { id: string; snippet: { topLevelComment: UpstreamComment; totalReplyCount: number } }
type ResponseBody<T> = { items?: T[]; nextPageToken?: string; error?: { status?: string; errors?: { reason: string }[]; details?: { reason?: string }[] } }

async function yt<T>(env: Bindings, endpoint: 'channels' | 'playlists' | 'playlistItems' | 'videos' | 'commentThreads' | 'comments', query: Record<string, string>) {
  if (!env.YOUTUBE_API_KEY?.trim()) fail('configuration', 503)
  await charge(env, 'api')
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`)
  for (const [key, value] of Object.entries(query)) if (value) url.searchParams.set(key, value)
  let response: Response
  let data: ResponseBody<T>
  try {
    response = await fetch(url.toString(), {
      headers: { 'X-Goog-Api-Key': env.YOUTUBE_API_KEY, Accept: 'application/json' },
      redirect: 'manual', signal: AbortSignal.timeout(6500),
    })
    data = await response.json() as ResponseBody<T>
  } catch { fail('network', 502) }
  if (!response.ok) {
    const reasons = [...data.error?.errors ?? [], ...data.error?.details ?? []].map(e => e.reason ?? '')
    if (reasons.includes('commentsDisabled')) fail('commentsDisabled', 403)
    if (response.status === 404 || reasons.some(r => ['playlistNotFound', 'videoNotFound', 'channelNotFound', 'playlistItemsNotAccessible', 'playlistForbidden'].includes(r))) fail('missing', 404)
    if (reasons.includes('invalidPageToken')) fail('page', 400)
    if (response.status === 429 || reasons.some(r => /quotaExceeded|dailyLimitExceeded|rateLimitExceeded/i.test(r))) {
      await stmt(env, 'UPDATE budget SET blocked=1 WHERE day=?', apiDay()).run()
      fail('quota', 429)
    }
    if (response.status === 401 || reasons.some(r => /keyInvalid|accessNotConfigured|API_KEY|SERVICE_DISABLED|ipRefererBlocked/i.test(r))) fail('credentials', 503)
    if (response.status === 403 && (endpoint === 'commentThreads' || endpoint === 'comments')) fail('commentsUnavailable', 403)
    if (response.status === 403) fail('credentials', 503)
    fail('network', 502)
  }
  return { items: data.items ?? [], next: data.nextPageToken }
}
const thumb = (s: Snippet) => s.thumbnails?.high?.url ?? s.thumbnails?.medium?.url ?? s.thumbnails?.default?.url ?? ''
const thumbnailFields = 'thumbnails(default/url,medium/url,high/url)'
export async function getChannel(env: Bindings, selector: { id: string } | { handle: string }): Promise<Channel> {
  const { items: [item] } = await yt<YTItem>(env, 'channels', {
    ...('id' in selector ? selector : { forHandle: selector.handle }),
    part: 'snippet,contentDetails,brandingSettings',
    fields: `items(id,snippet(title,description,customUrl,${thumbnailFields}),contentDetails/relatedPlaylists/uploads,brandingSettings/image/bannerExternalUrl)`,
  })
  if (!item?.contentDetails?.relatedPlaylists?.uploads) fail('missing', 404)
  const s = item.snippet
  return {
    kind: 'channel', id: item.id, title: s.title, description: s.description ?? '', thumbnail: thumb(s),
    handle: handle(s.customUrl) ? s.customUrl : 'handle' in selector ? selector.handle : undefined,
    banner: item.brandingSettings?.image?.bannerExternalUrl, uploads: item.contentDetails.relatedPlaylists.uploads,
  }
}
function playlist(item: YTItem): Playlist {
  const s = item.snippet
  return { kind: 'playlist', id: item.id, title: s.title, description: s.description ?? '', thumbnail: thumb(s),
    channelId: s.channelId, channelTitle: s.channelTitle, count: item.contentDetails?.itemCount ?? 0 }
}
const playlistQuery = {
  part: 'snippet,contentDetails,status',
  fields: `nextPageToken,items(id,snippet(title,description,channelId,channelTitle,${thumbnailFields}),contentDetails/itemCount,status/privacyStatus)`,
}
export async function getPlaylist(env: Bindings, id: string) {
  const { items: [item] } = await yt<YTItem>(env, 'playlists', { ...playlistQuery, id })
  if (!item || item.status?.privacyStatus !== 'public') fail('missing', 404)
  return playlist(item)
}
export async function getChannelPlaylists(env: Bindings, id: string, pageToken: string): Promise<Page<Playlist>> {
  const { items, next } = await yt<YTItem>(env, 'playlists', { ...playlistQuery, channelId: id, pageToken, maxResults: '20' })
  return { items: items.filter(item => item.status?.privacyStatus === 'public').map(playlist), next }
}
export async function getItems(env: Bindings, playlistId: string, pageToken: string | null) {
  const { items, next } = await yt<YTItem>(env, 'playlistItems', {
    part: 'snippet,contentDetails', playlistId, pageToken: pageToken ?? '', maxResults: '24',
    fields: 'nextPageToken,items(id,snippet(position,resourceId/videoId),contentDetails/videoId)',
  })
  return { next, items: items.map(item => {
    const id = item.contentDetails?.videoId ?? item.snippet.resourceId?.videoId
    return { itemId: item.id, videoId: videoId(id) ? id : null, position: item.snippet.position ?? 0 }
  }) }
}
export async function getVideos(env: Bindings, ids: string[]) {
  if (!ids.length) return []
  const { items } = await yt<YTItem>(env, 'videos', {
    id: ids.join(','), part: 'snippet,contentDetails,status',
    fields: `items(id,snippet(title,description,publishedAt,channelId,channelTitle,${thumbnailFields}),contentDetails(duration,regionRestriction),status(privacyStatus,embeddable))`,
  })
  return items.filter(item => item.status?.privacyStatus !== 'private').map((item): Video => {
    const s = item.snippet
    return { kind: 'video', id: item.id, title: s.title, description: s.description ?? '', thumbnail: thumb(s),
      channelId: s.channelId, channelTitle: s.channelTitle, published: s.publishedAt,
      duration: timeSeconds(item.contentDetails?.duration?.replace(/^PT/, '').toLowerCase()) ?? 0,
      embeddable: item.status?.embeddable === true, public: item.status?.privacyStatus === 'public', region: item.contentDetails?.regionRestriction,
    }
  })
}

const commentFields = 'authorDisplayName,authorChannelId/value,textDisplay,publishedAt,likeCount'
function comment(item: UpstreamComment, replies: number): Comment {
  const s = item.snippet
  return { id: item.id, author: s.authorDisplayName, channelId: channelId(s.authorChannelId?.value) ? s.authorChannelId.value : undefined,
    text: s.textDisplay, published: s.publishedAt, likes: s.likeCount, replies }
}
export async function getComments(env: Bindings, id: string, pageToken: string, order: 'time' | 'relevance', parent?: string): Promise<Page<Comment>> {
  const common = { part: 'snippet', textFormat: 'plainText', maxResults: '20', pageToken }
  if (parent) {
    const { items, next } = await yt<UpstreamComment>(env, 'comments', {
      ...common, parentId: parent, fields: `nextPageToken,items(id,snippet(${commentFields}))`,
    })
    return { items: items.map(item => comment(item, 0)), next }
  }
  const { items, next } = await yt<Thread>(env, 'commentThreads', {
    ...common, videoId: id, order,
    fields: `nextPageToken,items(snippet(totalReplyCount,topLevelComment(id,snippet(${commentFields}))))`,
  })
  return { items: items.map(item => comment(item.snippet.topLevelComment, item.snippet.totalReplyCount)), next }
}
