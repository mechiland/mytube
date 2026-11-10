import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Bookmark, Check, ChevronLeft, ChevronRight, ExternalLink, ListVideo, RectangleHorizontal, Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { api, formatDate, sourceQuery, videoQuery } from '@/lib/client'
import type { Item, Page, Playlist, Video } from '@/lib/data'
import { armPlayback, consumePlayback } from '@/lib/playback'
import { recordProgress, saveFavorite, useLibrary } from '@/lib/personal'
import { timeSeconds, type watchSearch } from '@/lib/youtube-url'
import { LoadMore, PlaylistItems, useFeed } from './browse'
import { ChannelAvatar, ChannelLink, Loading, Notice } from './common'
import { Comments } from './comments'
import { Player } from './player'
import VideoCard from './video-card'

type Search = ReturnType<typeof watchSearch>
type Queue = { items: Item[]; cursor?: string; position?: number; previous?: Item; next?: Item; first?: Item; complete: boolean }
export function WatchPage({ search }: { search: Search }) {
  const query = useQuery(videoQuery(search.v))
  if (!search.v) return <section className="page"><Notice title="无效的视频链接" /></section>
  if (query.isPending) return <section className="page watch-placeholder"><Loading label="正在读取视频…" /></section>
  if (!query.data || query.error) return <section className="page"><Notice title="无法打开视频" error={query.error} retry={() => void query.refetch()} />
    <a href={`https://www.youtube.com/watch?v=${search.v}`} target="_blank" rel="noopener">在 YouTube 打开</a></section>
  return <WatchContent search={search} video={query.data} />
}
function WatchContent({ search, video }: { search: Search; video: Video }) {
  const { list, index, t } = search
  const navigate = useNavigate()
  const playToken = useLocation({ select: location => location.state.playAll })
  const { state, update } = useLibrary()
  const [auto, setAuto] = useState(false)
  const [continuous, setContinuous] = useState(false)
  const [theater, setTheater] = useState(false)
  const [copied, setCopied] = useState(false)
  const author = useQuery(sourceQuery('channel', video.channelId, undefined, false))
  const listQuery = useQuery({ ...sourceQuery('playlist', list), refetchInterval: q => q.state.data?.status?.complete === false && !q.state.data.status.error ? 60_000 : false })
  const queue = useQuery({
    queryKey: ['queue', list, video.id, index, listQuery.data?.status?.count, listQuery.data?.status?.checked],
    queryFn: ({ signal }) => api<Queue>('queue', { id: list, v: video.id, index }, signal), enabled: !!list && !!listQuery.data,
  })
  const nextRows = useInfiniteQuery({
    queryKey: ['queue-more', list, video.id, index, queue.data?.cursor], enabled: false,
    queryFn: ({ pageParam, signal }) => api<Page<Item>>('playlist', { id: list, cursor: pageParam }, signal),
    initialPageParam: queue.data?.cursor, getNextPageParam: p => p.next,
  })
  const adjacent = queue.data
  const listInfo = listQuery.data?.data as Playlist | undefined
  const next = adjacent?.next?.video?.embeddable ? adjacent.next : undefined
  const previous = adjacent?.previous?.video?.embeddable ? adjacent.previous : undefined
  const nextItem = next ?? (state.loop && adjacent?.position !== undefined && adjacent.complete && adjacent.first?.video?.embeddable ? adjacent.first : undefined)
  const time = timeSeconds(t)
  const external = 'https://www.youtube.com/watch?' + new URLSearchParams({ v: video.id, ...(list ? { list } : {}),
    ...(index ? { index: String(index) } : {}), ...(t ? { t } : {}) })
  const saved = state.favorites.includes(video.id)
  useEffect(() => {
    if (list && consumePlayback(playToken, { v: video.id, list, index })) { setAuto(true); setContinuous(true) }
  }, [list, playToken, video.id, index])
  const position = adjacent?.position
  useEffect(() => {
    if (list && position !== undefined && position + 1 !== index && !auto) {
      void navigate({ to: '/watch', search: { ...search, index: position + 1 }, replace: true, resetScroll: false })
    }
  }, [list, position, index, auto, navigate, search])
  function jump(item: Item | undefined, play: boolean) {
    if (!item?.videoId || !list) return
    const target = { v: item.videoId, list, index: item.position + 1 }
    void navigate({ to: '/watch', search: target, state: play ? { playAll: armPlayback(target) } : {} })
  }
  return <section className={theater ? 'watch-page theater' : 'watch-page'}>
    <div className="watch-screen">
      <Player key={playToken ?? video.id} video={video} time={time} auto={auto} resume={state.progress[video.id]} external={external}
        onProgress={p => { void update(s => recordProgress(s, video.id, p)) }} onEnded={() => { if (continuous) jump(nextItem, true) }} />
    </div>
    <div className="watch-info">
      <h1>{video.title}</h1>
      <div className="watch-actions">
        <ChannelLink id={video.channelId} className="watch-author"><ChannelAvatar name={video.channelTitle} url={author.data?.data.thumbnail} /><strong>{video.channelTitle}</strong></ChannelLink>
        <div className="watch-buttons">
          <Button variant="secondary" size="sm" onClick={async () => {
            if (await update(s => saveFavorite(s, video.id, !saved, { t, list, index }))) toast.success(saved ? '已移除收藏' : '已收藏此视频')
          }}>{saved ? <Check data-icon="inline-start" /> : <Bookmark data-icon="inline-start" />}{saved ? '已收藏' : '收藏'}</Button>
          <Button variant="secondary" size="sm" onClick={async () => {
            try { await navigator.clipboard.writeText(window.location.href); setCopied(true); toast.success('已复制站内链接') }
            catch { toast.error('无法访问剪贴板，可复制地址栏链接') }
          }}><Share2 data-icon="inline-start" />{copied ? '已复制' : '分享'}</Button>
          <Button variant={theater ? 'soft' : 'secondary'} size="sm" aria-pressed={theater} onClick={() => setTheater(v => !v)}><RectangleHorizontal data-icon="inline-start" />影院模式</Button>
          <Button variant="ghost" size="icon-sm" aria-label="在 YouTube 打开" nativeButton={false} render={<a href={external} target="_blank" rel="noopener" />}><ExternalLink /></Button>
        </div>
      </div>
      <details className="video-description">
        <summary><strong>{formatDate(video.published)}</strong><span>{video.description ? '查看简介' : '视频简介'}</span></summary>
        <p>{video.description || '此视频没有公开简介。'}</p>
      </details>
      <Comments video={video.id} />
    </div>
    <aside className="watch-side">
      {list ? <section className="queue">
        <div className="queue-heading">
          <p className="eyebrow"><ListVideo /> 播放列表</p>
          <h2><Link to="/playlist" search={{ list }}>{listInfo?.title ?? '当前播放列表'}</Link></h2>
          <p className="muted">{position !== undefined ? `第 ${position + 1} 项 · ` : ''}{listInfo ? `共 ${listInfo.count} 部视频` : ''}
            {adjacent?.complete && position === undefined ? ' · 此视频不在该列表中' : ''}</p>
          <div className="queue-controls">
            <Button size="icon-sm" variant="ghost" aria-label="上一条" disabled={!previous} onClick={() => jump(previous, continuous)}><ChevronLeft /></Button>
            <Button size="icon-sm" variant="ghost" aria-label="下一条" disabled={!next} onClick={() => jump(next, continuous)}><ChevronRight /></Button>
            <label className="switch-label"><Switch checked={continuous} onCheckedChange={setContinuous} />连续播放</label>
          </div>
        </div>
        {listQuery.error && <Notice error={listQuery.error} retry={() => void listQuery.refetch()} />}
        {queue.error && <Notice error={queue.error} retry={() => void queue.refetch()} />}
        {queue.isLoading && <Loading />}
        <div className="queue-scroll">
          <PlaylistItems items={[...(queue.data?.items ?? []), ...(nextRows.data?.pages.flatMap(p => p.items) ?? [])]} list={list} active={position} />
          {nextRows.error && <Notice error={nextRows.error} retry={() => void nextRows.fetchNextPage()} />}
          <LoadMore more={nextRows.data ? nextRows.hasNextPage : !!queue.data?.cursor} loading={nextRows.isFetchingNextPage} next={() => void nextRows.fetchNextPage()} />
        </div>
      </section> : <FromLibrary id={video.id} />}
    </aside>
  </section>
}
function FromLibrary({ id }: { id: string }) {
  const query = useFeed({})
  const videos = (query.data?.pages[0].items ?? []).filter(v => v.id !== id).slice(0, 6)
  return <section className="watch-library"><h2>来自我的内容库</h2>
    {videos.length ? videos.map(v => <VideoCard key={v.id} video={v} row />)
      : <p className="muted">{query.isLoading ? '正在读取…' : '你的库中还没有其他可显示的视频。'}</p>}
  </section>
}
