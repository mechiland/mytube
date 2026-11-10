import { Link, useNavigate } from '@tanstack/react-router'
import { useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bookmark, Clock3, LayoutGrid, LibraryBig, ListVideo, Play, SearchX, TvMinimalPlay } from 'lucide-react'
import { lazy, Suspense, useEffect } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { TabNav } from '@/components/ui/tab-nav'
import { api, safeImage, sourceQuery, videoQuery } from '@/lib/client'
import type { Channel, Item, LibraryPage, Page, Playlist, SourceKind, Video } from '@/lib/data'
import { armPlayback } from '@/lib/playback'
import { saveFavorite, saveSource, useLibrary } from '@/lib/personal'
import { channelId, playlistId } from '@/lib/youtube-url'
import { ChannelAvatar, ChannelLink, Cover, Loading, Notice, SyncLine, ToggleSource, videoLink } from './common'
import { OpenAdd } from './shell'
const VideoCard = lazy(() => import('./video-card'))

type Filter = { order?: 'old'; source?: string }
export const feedSearch = (s: Record<string, unknown>): Filter => ({
  order: s.order === 'old' ? 'old' : undefined,
  source: channelId(s.source) || playlistId(s.source) || s.source === 'favorites' ? s.source : undefined,
})
export const resultsSearch = (s: Record<string, unknown>) => ({
  ...feedSearch(s), search_query: typeof s.search_query === 'string' ? s.search_query.trim().slice(0, 120) : '',
})
type FeedParams = Filter & { q?: string; onlyChannel?: string; favorites?: boolean }

export function useFeed({ order, source, q, onlyChannel, favorites }: FeedParams) {
  const { ready, state } = useLibrary()
  const channels = onlyChannel ? [onlyChannel] : favorites ? [] : source ? state.channels.filter(v => v === source) : state.channels
  const playlists = onlyChannel || favorites ? [] : source ? state.playlists.filter(v => v === source) : state.playlists
  const ids = onlyChannel || (source && source !== 'favorites') ? [] : state.favorites
  const input = { channels, playlists, favorites: ids, hidden: state.hidden, q, order: order ?? 'new' }
  return useInfiniteQuery({
    queryKey: ['feed', input], enabled: ready && !!(channels.length || playlists.length || ids.length),
    queryFn: ({ pageParam, signal }) => api<LibraryPage>('feed', {}, signal, { ...input, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: page => page.next,
    refetchInterval: query => {
      const first = query.state.data?.pages[0]
      if ((query.state.data?.pages.length ?? 0) > 1) return false
      if (first && (first.statuses.some(s => !s.complete && !s.error) || first.statuses.length < channels.length + playlists.length)) return 60_000
      return false
    },
  })
}

function useSavedSources() {
  const { state, ready } = useLibrary()
  const client = useQueryClient()
  const entries = [...state.channels.map(id => ({ id, kind: 'channel' as const })), ...state.playlists.map(id => ({ id, kind: 'playlist' as const }))]
  const all = useQueries({ queries: entries.map(s => ({ ...sourceQuery(s.kind, s.id), enabled: ready })) })
  const completed = all.map(q => q.dataUpdatedAt).join(',')
  useEffect(() => {
    if (completed && completed.split(',').some(v => +v > 0)) void client.invalidateQueries({ queryKey: ['feed'] })
  }, [completed, client])
  return entries.map((entry, i) => ({ ...entry, query: all[i] }))
}

function FeedControls({ filters, change, sources }: { filters: Filter; change: (f: Filter) => void; sources?: ReturnType<typeof useSavedSources> }) {
  return <div className="feed-controls">
    {sources && <div className="chips" aria-label="来源筛选">
      <Button variant={filters.source ? 'secondary' : 'solid'} size="sm" aria-pressed={!filters.source} onClick={() => change({ ...filters, source: undefined })}>全部</Button>
      {sources.map(s => <Button key={s.id} size="sm" variant={filters.source === s.id ? 'solid' : 'secondary'} aria-pressed={filters.source === s.id}
        onClick={() => change({ ...filters, source: s.id })}>{s.query.data?.data.title ?? s.id}</Button>)}
      <Button variant={filters.source === 'favorites' ? 'solid' : 'secondary'} size="sm" aria-pressed={filters.source === 'favorites'} onClick={() => change({ ...filters, source: 'favorites' })}>单条收藏</Button>
    </div>}
    <NativeSelect aria-label="排序" value={filters.order ?? 'new'} onChange={e => change({ ...filters, order: e.target.value === 'old' ? 'old' : undefined })}>
      <NativeSelectOption value="new">最新发布</NativeSelectOption><NativeSelectOption value="old">最早发布</NativeSelectOption>
    </NativeSelect>
  </div>
}
function Blank({ title, description, kind, action }: { title: string; description: string; kind: 'library' | 'search' | 'favorites' | 'history' | 'playlist' | 'channel'; action?: boolean }) {
  const Icon = { library: LibraryBig, search: SearchX, favorites: Bookmark, history: Clock3, playlist: ListVideo, channel: TvMinimalPlay }[kind]
  return <Empty className="empty-state">
    <EmptyHeader><EmptyMedia variant="icon"><Icon /></EmptyMedia><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader>
    {action && <EmptyContent><OpenAdd>添加 YouTube 链接</OpenAdd></EmptyContent>}
  </Empty>
}
export function LoadMore({ more, loading, next }: { more: boolean; loading: boolean; next: () => void }) {
  return more && <div className="load-more"><Button variant="outline" disabled={loading} loading={loading} onClick={next}>加载更多</Button></div>
}
function FeedItems({ query, row, preserveContext, empty }: { query: ReturnType<typeof useFeed>; row?: boolean; preserveContext?: boolean; empty: string }) {
  const items = [...new Map((query.data?.pages.flatMap(p => p.items) ?? []).map(item => [item.id, item])).values()]
  return <>
    {query.isLoading && <Loading label="正在读取已同步的视频…" />}
    {query.error && <Notice error={query.error} retry={() => void query.refetch()} />}
    {!query.isLoading && !query.error && !items.length && <Blank kind={row ? 'search' : 'library'} title={empty} description="此处仅显示已同步且未隐藏的视频。" />}
    <div className={row ? 'result-list' : 'video-grid'}><Suspense fallback={items.length ? <Loading /> : null}>{items.map(v => <VideoCard key={v.id} video={v} row={row} preserveContext={preserveContext} />)}</Suspense></div>
    <LoadMore more={query.hasNextPage} loading={query.isFetchingNextPage} next={() => void query.fetchNextPage()} />
  </>
}
export function LibraryFeed({ filters, q, mode = 'home', change }: {
  filters: Filter; q?: string; mode?: 'home' | 'results' | 'favorites'; change: (filters: Filter) => void
}) {
  const { state, ready } = useLibrary()
  const sources = useSavedSources()
  const query = useFeed({ ...filters, q, favorites: mode === 'favorites' })
  const first = query.data?.pages[0]
  const pending = first?.statuses.filter(s => !s.complete) ?? []
  const paused = first?.statuses.filter(s => !!s.error) ?? []
  const hasSources = mode === 'favorites' ? !!state.favorites.length : !!(state.channels.length + state.playlists.length + state.favorites.length)
  return <section className="page library-page">
    <header className="page-heading">
      <p className="eyebrow"><LayoutGrid /> {mode === 'results' ? '库内搜索' : '我的内容库'}</p>
      <h1>{mode === 'results' ? (q ? `“${q}” 的搜索结果` : '搜索我的内容库') : mode === 'favorites' ? '收藏' : '首页'}</h1>
      <p className="muted">{mode === 'results' ? '搜索已同步内容的标题和频道名。' : mode === 'favorites' ? '这里收录你单独保存的视频。' : '来自你选择的频道、播放列表和收藏。'}</p>
    </header>
    {!ready ? <Loading label="正在读取此浏览器的内容库…" /> : !hasSources
      ? <Blank kind={mode === 'favorites' ? 'favorites' : 'library'} title={mode === 'favorites' ? '还没有收藏' : '你的内容库还是空的'} description="添加一个频道、视频或公开播放列表，开始建立自己的观看清单。" action />
      : <>
        <FeedControls filters={filters} change={change} sources={mode === 'favorites' ? undefined : sources} />
        {paused.length > 0 && <p className="library-sync muted" role="status">{paused.length} 个来源暂缓更新。已同步的视频仍可浏览。</p>}
        {pending.length > 0 && <p className="library-sync muted" role="status">{pending.length} 个来源尚未同步完毕。当前仅显示已同步内容。</p>}
        {sources.some(s => s.query.isError) && <Notice title="有来源未能加载" error={sources.find(s => s.query.error)?.query.error}
          retry={() => sources.filter(s => s.query.isError).forEach(s => { void s.query.refetch() })} />}
        {mode === 'favorites' && <FavoriteFallback videos={query.data?.pages.flatMap(p => p.items) ?? []} />}
        <FeedItems query={query} row={mode === 'results'} preserveContext empty={mode === 'results' ? '没有匹配的视频' : '目前没有可显示的视频'} />
      </>}
  </section>
}
function FavoriteFallback({ videos }: { videos: Video[] }) {
  // Cached metadata may expire while the browser still owns its saved video IDs.
  const { state, update } = useLibrary()
  const visible = new Set(videos.map(v => v.id))
  const ids = state.favorites.filter(id => !visible.has(id) && !state.hidden.includes(id)).slice(0, 8)
  const results = useQueries({ queries: ids.map(videoQuery) })
  const client = useQueryClient()
  const refreshed = results.filter(r => r.data).length
  useEffect(() => { if (refreshed) void client.invalidateQueries({ queryKey: ['feed'] }) }, [refreshed, client])
  return <>{results.map((r, i) => r.isError && <div className="missing-favorite" key={ids[i]}>
    <Link {...videoLink(ids[i], state.contexts[ids[i]])}>{ids[i]}</Link><span>{r.error.message}</span>
    <Button size="sm" variant="outline" onClick={async () => { if (await update(s => saveFavorite(s, ids[i], false))) toast.success('已移除收藏') }}>移除收藏</Button>
  </div>)}</>
}
export function SavedSources({ kind }: { kind: SourceKind }) {
  const { ready, update } = useLibrary()
  const sources = useSavedSources().filter(s => s.kind === kind)
  const title = kind === 'channel' ? '订阅频道' : '播放列表'
  return <section className="page">
    <header className="page-heading"><p className="eyebrow">我的内容库</p><h1>{title}</h1>
      <p className="muted">{kind === 'channel' ? '订阅保存在此浏览器。频道的新视频会自动同步到首页。' : '你保存的公开播放列表会随原列表更新。'}</p></header>
    {!ready ? <Loading /> : !sources.length ? <Blank kind={kind} title={`还没有${title}`} description="添加 YouTube 链接，或在浏览对应页面时直接保存。" action /> : <div className="source-list">
      {sources.map(({ query, id }) => {
        const data = query.data?.data
        return <article className="source-row" key={id}>
          {data ? <>
            {data.kind === 'channel' ? <ChannelLink id={id}><ChannelAvatar name={data.title} url={data.thumbnail} className="source-avatar" /></ChannelLink>
              : <Link to="/playlist" search={{ list: id }}><Cover url={data.thumbnail} /></Link>}
            <div className="source-row-text">{data.kind === 'channel' ? <ChannelLink id={id}><h2>{data.title}</h2></ChannelLink>
              : <Link to="/playlist" search={{ list: id }}><h2>{data.title}</h2></Link>}
              <SyncLine kind={kind} id={id} status={query.data?.status} refetch={() => void query.refetch()} /></div>
            <ToggleSource source={data} />
          </> : query.error ? <div className="source-unavailable"><Notice error={query.error} retry={() => void query.refetch()} />
            <Button variant="outline" size="sm" onClick={async () => {
              if (await update(s => saveSource(s, kind, id, false))) toast.success('已移除本地来源')
            }}>移除此来源</Button></div> : <Loading />}
        </article>
      })}
    </div>}
  </section>
}

export function History() {
  const { state, ready } = useLibrary()
  const ids = Object.entries(state.progress).filter(([id, p]) => !state.hidden.includes(id) && p.at >= 3 && p.duration - p.at > 3)
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt).slice(0, 200).map(([id]) => id)
  const query = useInfiniteQuery({
    enabled: ready && !!ids.length, queryKey: ['history', ids], initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => Promise.allSettled(ids.slice(pageParam, pageParam + 8).map(id => api<Video>('video', { id }, signal))),
    getNextPageParam: (_, pages) => pages.length * 8 < ids.length ? pages.length * 8 : undefined,
  })
  return <section className="page">
    <header className="page-heading"><p className="eyebrow">我的内容库</p><h1>继续观看</h1><p className="muted">从此浏览器上次播放的位置接着看。</p></header>
    {(!ready || query.isLoading) ? <Loading /> : !ids.length ? <Blank kind="history" title="还没有待继续的视频" description="开始播放后，mytube 会在本地记住你的进度。" />
      : <div className="video-grid"><Suspense fallback={<Loading />}>{query.data?.pages.flat().map((r, i) => r.status === 'fulfilled'
        ? <VideoCard key={r.value.id} video={r.value} preserveContext />
        : <Notice key={ids[i]} title="暂时无法加载视频" error={r.reason as Error} retry={() => void query.refetch()} />)}</Suspense></div>}
    <LoadMore more={query.hasNextPage} loading={query.isFetchingNextPage} next={() => void query.fetchNextPage()} />
  </section>
}

const channelTabs = [['featured', '首页'], ['videos', '视频'], ['playlists', '播放列表'], ['about', '简介']] as const
export type ChannelTab = typeof channelTabs[number][0]
export const isChannelTab = (value: string): value is ChannelTab => channelTabs.some(([key]) => key === value)
export function ChannelPage({ id, profile, tab = 'featured', filters, change }: {
  id?: string; profile?: string; tab?: ChannelTab; filters: Filter; change: (value: Filter) => void
}) {
  const query = useQuery({ ...sourceQuery('channel', id, profile), refetchInterval: q => q.state.data?.status?.complete === false && !q.state.data.status.error ? 60_000 : false })
  const client = useQueryClient()
  const data = query.data?.data as Channel | undefined
  const videos = useFeed({ order: filters.order, onlyChannel: tab === 'featured' || tab === 'videos' ? data?.id : undefined, favorites: tab === 'about' || tab === 'playlists' || !data, source: !data || tab === 'about' || tab === 'playlists' ? 'unused' : undefined })
  const lists = useInfiniteQuery({
    queryKey: ['channel-lists', data?.id], enabled: !!data && tab === 'playlists', initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => api<Page<Playlist>>('channel-lists', { id: data?.id, cursor: pageParam }, signal),
    getNextPageParam: page => page.next,
  })
  if (query.isPending) return <section className="page"><Loading label="正在加载频道…" /></section>
  if (query.error || !data) return <section className="page"><Notice title="无法打开频道" error={query.error} retry={() => void query.refetch()} /></section>
  return <section className="page channel-page">
    {safeImage(data.banner) ? <div className="channel-banner"><img src={safeImage(data.banner)} alt="" decoding="async" onError={e => { e.currentTarget.hidden = true }} /></div>
      : <div className="channel-banner banner-fallback" aria-hidden="true" />}
    <header className="channel-header">
      <ChannelAvatar name={data.title} url={data.thumbnail} className="channel-avatar" />
      <div className="channel-summary">
        <h1>{data.title}</h1>
        {data.handle && <p>{data.handle}</p>}
        {data.description && <p className="muted summary-line">{data.description}</p>}
        <div className="channel-actions"><ToggleSource source={data} /><span className="muted">仅订阅到此浏览器</span></div>
      </div>
    </header>
    <TabNav aria-label="频道页签" className="channel-tabs">{channelTabs.map(([key, label]) =>
      profile ? <Link key={key} to={key === 'featured' ? '/$profile' : '/$profile/$tab'} params={{ profile, tab: key }} search={{}}>
        {({ isActive }) => <span className={tab === key || isActive && key !== 'featured' ? 'channel-tab active' : 'channel-tab'}>{label}</span>}
      </Link> : <Link key={key} to={key === 'featured' ? '/channel/$id' : '/channel/$id/$tab'} params={{ id: data.id, tab: key }} search={{}}>
        <span className={tab === key ? 'channel-tab active' : 'channel-tab'}>{label}</span>
      </Link>)}</TabNav>
    {tab === 'about' ? <div className="about"><h2>频道简介</h2><p>{data.description || '此频道没有公开简介。'}</p></div>
      : tab === 'playlists' ? <>
        {lists.isLoading && <Loading />}
        {lists.error && <Notice error={lists.error} retry={() => void lists.refetch()} />}
        {lists.data?.pages[0].items.length === 0 && <Blank title="没有公开播放列表" description="可以在「视频」页继续浏览此频道。" kind="playlist" />}
        <div className="video-grid">{lists.data?.pages.flatMap(p => p.items).map(p => <PlaylistCard key={p.id} list={p} />)}</div>
        <LoadMore more={lists.hasNextPage} loading={lists.isFetchingNextPage} next={() => void lists.fetchNextPage()} />
      </> : <>
        <SyncLine kind="channel" id={data.id} status={videos.data?.pages[0].statuses[0] ?? query.data?.status} refetch={() => {
          void query.refetch(); void client.invalidateQueries({ queryKey: ['feed'] })
        }} />
        <FeedControls filters={filters} change={change} />
        <FeedItems query={videos} empty="还没有已同步的公开视频" />
      </>}
  </section>
}
function PlaylistCard({ list }: { list: Playlist }) {
  return <article className="playlist-card">
    <Link to="/playlist" search={{ list: list.id }}><div className="playlist-cover"><Cover url={list.thumbnail} /><span><ListVideo />{list.count} 部视频</span></div><h2>{list.title}</h2></Link>
    <ChannelLink id={list.channelId} className="muted">{list.channelTitle}</ChannelLink>
  </article>
}
export function PlaylistItems({ items, list, active }: { items: Item[]; list: string; active?: number }) {
  return <ol className="playlist-items">{items.map(item => <li key={item.itemId} className={active === item.position ? 'queue-current' : undefined}>
    <span className="item-position" aria-label={`第 ${item.position + 1} 项`}>{active === item.position ? <Play /> : item.position + 1}</span>
    {item.video ? <Link {...videoLink(item.video.id, { list, index: item.position + 1 })} className="playlist-item-link" aria-current={active === item.position ? 'true' : undefined}>
      <Cover url={item.video.thumbnail} duration={item.video.duration} />
      <div><strong>{item.video.title}</strong><p className="muted">{item.video.channelTitle}</p>{!item.video.embeddable && <p className="muted">不允许嵌入播放</p>}</div>
    </Link> : <div className="playlist-item-link unavailable"><Cover url="" /><div><strong>此视频不可用</strong><p className="muted">保留原列表位置</p></div></div>}
  </li>)}</ol>
}
export function PlaylistPage({ id }: { id?: string }) {
  const navigate = useNavigate()
  const query = useQuery({ ...sourceQuery('playlist', id), refetchInterval: q => q.state.data?.status?.complete === false && !q.state.data.status.error ? 60_000 : false })
  const list = query.data?.data as Playlist | undefined
  const firstPlayable = useMutation({ mutationFn: () => api<Item | null>('playlist-first', { id }) })
  const rows = useInfiniteQuery({
    queryKey: ['playlist', id, query.data?.status?.checked, query.data?.status?.count], enabled: !!list, initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => api<Page<Item>>('playlist', { id, cursor: pageParam }, signal),
    getNextPageParam: page => page.next,
  })
  if (!id) return <section className="page"><Notice title="无效的播放列表链接" /></section>
  if (query.isPending) return <section className="page"><Loading label="正在加载播放列表…" /></section>
  if (!list || query.error) return <section className="page"><Notice title="无法打开播放列表" error={query.error} retry={() => void query.refetch()} /></section>
  const items = rows.data?.pages.flatMap(p => p.items) ?? []
  const first = items.find(i => i.video?.embeddable)
  return <section className="page playlist-page">
    <aside className="playlist-intro">
      <Cover url={list.thumbnail} eager />
      <p className="eyebrow"><ListVideo /> 公开播放列表</p>
      <h1>{list.title}</h1><ChannelLink id={list.channelId}>{list.channelTitle}</ChannelLink>
      <p className="muted">{list.count} 部视频</p>
      <div className="playlist-actions">
        <Button disabled={(!first?.videoId && !rows.hasNextPage) || firstPlayable.isPending} onClick={async () => {
          try {
            const item = first ?? await firstPlayable.mutateAsync()
            if (!item?.videoId) { toast.info('此列表暂时没有可嵌入播放的视频。'); return }
            const target = { v: item.videoId, list: id, index: item.position + 1 }
            void navigate({ to: '/watch', search: target, state: { playAll: armPlayback(target) } })
          } catch (e) { toast.error((e as Error).message) }
        }}><Play data-icon="inline-start" />播放全部</Button>
        <ToggleSource source={list} />
      </div>
      {list.description && <details className="list-description"><summary>查看简介</summary><p>{list.description}</p></details>}
      <SyncLine kind="playlist" id={id} status={query.data?.status} refetch={() => { void query.refetch(); void rows.refetch() }} />
    </aside>
    <div className="playlist-body">
      <h2>列表视频</h2>
      {rows.isLoading && <Loading />}
      {rows.error && <Notice error={rows.error} retry={() => void rows.refetch()} />}
      {!rows.isLoading && !rows.error && !items.length && <p className="muted">此列表暂无已同步的条目。</p>}
      <PlaylistItems items={items} list={id} />
      <LoadMore more={rows.hasNextPage} loading={rows.isFetchingNextPage} next={() => void rows.fetchNextPage()} />
    </div>
  </section>
}
