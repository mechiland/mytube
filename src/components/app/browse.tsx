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
import { useLocale } from '@/lib/i18n'
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
  const { t } = useLocale()
  return <div className="feed-controls">
    {sources && <div className="chips" aria-label={t('filterSources')}>
      <Button variant={filters.source ? 'secondary' : 'solid'} size="sm" aria-pressed={!filters.source} onClick={() => change({ ...filters, source: undefined })}>{t('all')}</Button>
      {sources.map(s => <Button key={s.id} size="sm" variant={filters.source === s.id ? 'solid' : 'secondary'} aria-pressed={filters.source === s.id}
        onClick={() => change({ ...filters, source: s.id })}>{s.query.data?.data.title ?? s.id}</Button>)}
      <Button variant={filters.source === 'favorites' ? 'solid' : 'secondary'} size="sm" aria-pressed={filters.source === 'favorites'} onClick={() => change({ ...filters, source: 'favorites' })}>{t('individualFavorites')}</Button>
    </div>}
    <NativeSelect aria-label={t('sort')} value={filters.order ?? 'new'} onChange={e => change({ ...filters, order: e.target.value === 'old' ? 'old' : undefined })}>
      <NativeSelectOption value="new">{t('newestPublished')}</NativeSelectOption><NativeSelectOption value="old">{t('oldestPublished')}</NativeSelectOption>
    </NativeSelect>
  </div>
}
function Blank({ title, description, kind, action }: { title: string; description: string; kind: 'library' | 'search' | 'favorites' | 'history' | 'playlist' | 'channel'; action?: boolean }) {
  const { t } = useLocale()
  const Icon = { library: LibraryBig, search: SearchX, favorites: Bookmark, history: Clock3, playlist: ListVideo, channel: TvMinimalPlay }[kind]
  return <Empty className="empty-state">
    <EmptyHeader><EmptyMedia variant="icon"><Icon /></EmptyMedia><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader>
    {action && <EmptyContent><OpenAdd>{t('addYouTubeLink')}</OpenAdd></EmptyContent>}
  </Empty>
}
export function LoadMore({ more, loading, next }: { more: boolean; loading: boolean; next: () => void }) {
  const { t } = useLocale()
  return more && <div className="load-more"><Button variant="outline" disabled={loading} loading={loading} onClick={next}>{t('loadMore')}</Button></div>
}
function FeedItems({ query, row, preserveContext, empty }: { query: ReturnType<typeof useFeed>; row?: boolean; preserveContext?: boolean; empty: string }) {
  const { t } = useLocale()
  const items = [...new Map((query.data?.pages.flatMap(p => p.items) ?? []).map(item => [item.id, item])).values()]
  return <>
    {query.isLoading && <Loading label={t('loadingSyncedVideos')} />}
    {query.error && <Notice error={query.error} retry={() => void query.refetch()} />}
    {!query.isLoading && !query.error && !items.length && <Blank kind={row ? 'search' : 'library'} title={empty} description={t('syncedVisibleVideos')} />}
    <div className={row ? 'result-list' : 'video-grid'}><Suspense fallback={items.length ? <Loading /> : null}>{items.map(v => <VideoCard key={v.id} video={v} row={row} preserveContext={preserveContext} />)}</Suspense></div>
    <LoadMore more={query.hasNextPage} loading={query.isFetchingNextPage} next={() => void query.fetchNextPage()} />
  </>
}
export function LibraryFeed({ filters, q, mode = 'home', change }: {
  filters: Filter; q?: string; mode?: 'home' | 'results' | 'favorites'; change: (filters: Filter) => void
}) {
  const { state, ready } = useLibrary()
  const { t } = useLocale()
  const sources = useSavedSources()
  const query = useFeed({ ...filters, q, favorites: mode === 'favorites' })
  const first = query.data?.pages[0]
  const pending = first?.statuses.filter(s => !s.complete) ?? []
  const paused = first?.statuses.filter(s => !!s.error) ?? []
  const hasSources = mode === 'favorites' ? !!state.favorites.length : !!(state.channels.length + state.playlists.length + state.favorites.length)
  return <section className="page library-page">
    <header className="page-heading">
      <p className="eyebrow"><LayoutGrid /> {mode === 'results' ? t('librarySearch') : t('myLibrary')}</p>
      <h1>{mode === 'results' ? (q ? t('searchResults', { query: q }) : t('searchLibrary')) : mode === 'favorites' ? t('favorites') : t('home')}</h1>
      <p className="muted">{mode === 'results' ? t('searchHelp') : mode === 'favorites' ? t('favoritesHelp') : t('homeHelp')}</p>
    </header>
    {!ready ? <Loading label={t('loadingLibrary')} /> : !hasSources
      ? <Blank kind={mode === 'favorites' ? 'favorites' : 'library'} title={mode === 'favorites' ? t('noFavorites') : t('libraryEmpty')} description={t('getStarted')} action />
      : <>
        <FeedControls filters={filters} change={change} sources={mode === 'favorites' ? undefined : sources} />
        {paused.length > 0 && <p className="library-sync muted" role="status">{t('sourcesPaused', { count: paused.length })}</p>}
        {pending.length > 0 && <p className="library-sync muted" role="status">{t('sourcesPending', { count: pending.length })}</p>}
        {sources.some(s => s.query.isError) && <Notice title={t('sourcesFailed')} error={sources.find(s => s.query.error)?.query.error}
          retry={() => sources.filter(s => s.query.isError).forEach(s => { void s.query.refetch() })} />}
        {mode === 'favorites' && <FavoriteFallback videos={query.data?.pages.flatMap(p => p.items) ?? []} />}
        <FeedItems query={query} row={mode === 'results'} preserveContext empty={mode === 'results' ? t('noSearchResults') : t('noVisibleVideos')} />
      </>}
  </section>
}
function FavoriteFallback({ videos }: { videos: Video[] }) {
  const { t, errorText } = useLocale()
  // Cached metadata may expire while the browser still owns its saved video IDs.
  const { state, update } = useLibrary()
  const visible = new Set(videos.map(v => v.id))
  const ids = state.favorites.filter(id => !visible.has(id) && !state.hidden.includes(id)).slice(0, 8)
  const results = useQueries({ queries: ids.map(videoQuery) })
  const client = useQueryClient()
  const refreshed = results.filter(r => r.data).length
  useEffect(() => { if (refreshed) void client.invalidateQueries({ queryKey: ['feed'] }) }, [refreshed, client])
  return <>{results.map((r, i) => r.isError && <div className="missing-favorite" key={ids[i]}>
    <Link {...videoLink(ids[i], state.contexts[ids[i]])}>{ids[i]}</Link><span>{errorText(r.error)}</span>
    <Button size="sm" variant="outline" onClick={async () => { if (await update(s => saveFavorite(s, ids[i], false))) toast.success(t('favoriteRemoved')) }}>{t('removeFavorite')}</Button>
  </div>)}</>
}
export function SavedSources({ kind }: { kind: SourceKind }) {
  const { t } = useLocale()
  const { ready, update } = useLibrary()
  const sources = useSavedSources().filter(s => s.kind === kind)
  const title = kind === 'channel' ? t('subscriptions') : t('playlists')
  return <section className="page">
    <header className="page-heading"><p className="eyebrow">{t('myLibrary')}</p><h1>{title}</h1>
      <p className="muted">{kind === 'channel' ? t('subscriptionsHelp') : t('playlistsHelp')}</p></header>
    {!ready ? <Loading /> : !sources.length ? <Blank kind={kind} title={t(kind === 'channel' ? 'noSubscriptions' : 'noPlaylists')} description={t('saveSourceHelp')} action /> : <div className="source-list">
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
              if (await update(s => saveSource(s, kind, id, false))) toast.success(t('sourceRemoved'))
            }}>{t('removeSource')}</Button></div> : <Loading />}
        </article>
      })}
    </div>}
  </section>
}

export function History() {
  const { t } = useLocale()
  const { state, ready } = useLibrary()
  const ids = Object.entries(state.progress).filter(([id, p]) => !state.hidden.includes(id) && p.at >= 3 && p.duration - p.at > 3)
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt).slice(0, 200).map(([id]) => id)
  const query = useInfiniteQuery({
    enabled: ready && !!ids.length, queryKey: ['history', ids], initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => Promise.allSettled(ids.slice(pageParam, pageParam + 8).map(id => api<Video>('video', { id }, signal))),
    getNextPageParam: (_, pages) => pages.length * 8 < ids.length ? pages.length * 8 : undefined,
  })
  return <section className="page">
    <header className="page-heading"><p className="eyebrow">{t('myLibrary')}</p><h1>{t('continueWatching')}</h1><p className="muted">{t('continueHelp')}</p></header>
    {(!ready || query.isLoading) ? <Loading /> : !ids.length ? <Blank kind="history" title={t('noHistory')} description={t('historyHelp')} />
      : <div className="video-grid"><Suspense fallback={<Loading />}>{query.data?.pages.flat().map((r, i) => r.status === 'fulfilled'
        ? <VideoCard key={r.value.id} video={r.value} preserveContext />
        : <Notice key={ids[i]} title={t('videoLoadFailed')} error={r.reason as Error} retry={() => void query.refetch()} />)}</Suspense></div>}
    <LoadMore more={query.hasNextPage} loading={query.isFetchingNextPage} next={() => void query.fetchNextPage()} />
  </section>
}

const channelTabs = [['featured', 'home'], ['videos', 'videos'], ['playlists', 'playlists'], ['about', 'about']] as const
export type ChannelTab = typeof channelTabs[number][0]
export const isChannelTab = (value: string): value is ChannelTab => channelTabs.some(([key]) => key === value)
export function ChannelPage({ id, profile, tab = 'featured', filters, change }: {
  id?: string; profile?: string; tab?: ChannelTab; filters: Filter; change: (value: Filter) => void
}) {
  const { t } = useLocale()
  const query = useQuery({ ...sourceQuery('channel', id, profile), refetchInterval: q => q.state.data?.status?.complete === false && !q.state.data.status.error ? 60_000 : false })
  const client = useQueryClient()
  const data = query.data?.data as Channel | undefined
  const videos = useFeed({ order: filters.order, onlyChannel: tab === 'featured' || tab === 'videos' ? data?.id : undefined, favorites: tab === 'about' || tab === 'playlists' || !data, source: !data || tab === 'about' || tab === 'playlists' ? 'unused' : undefined })
  const lists = useInfiniteQuery({
    queryKey: ['channel-lists', data?.id], enabled: !!data && tab === 'playlists', initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => api<Page<Playlist>>('channel-lists', { id: data?.id, cursor: pageParam }, signal),
    getNextPageParam: page => page.next,
  })
  if (query.isPending) return <section className="page"><Loading label={t('loadingChannel')} /></section>
  if (query.error || !data) return <section className="page"><Notice title={t('channelOpenFailed')} error={query.error} retry={() => void query.refetch()} /></section>
  return <section className="page channel-page">
    {safeImage(data.banner) ? <div className="channel-banner"><img src={safeImage(data.banner)} alt="" decoding="async" onError={e => { e.currentTarget.hidden = true }} /></div>
      : <div className="channel-banner banner-fallback" aria-hidden="true" />}
    <header className="channel-header">
      <ChannelAvatar name={data.title} url={data.thumbnail} className="channel-avatar" />
      <div className="channel-summary">
        <h1>{data.title}</h1>
        {data.handle && <p>{data.handle}</p>}
        {data.description && <p className="muted summary-line">{data.description}</p>}
        <div className="channel-actions"><ToggleSource source={data} /><span className="muted">{t('localSubscription')}</span></div>
      </div>
    </header>
    <TabNav aria-label={t('channelTabs')} className="channel-tabs">{channelTabs.map(([key, label]) =>
      profile ? <Link key={key} to={key === 'featured' ? '/$profile' : '/$profile/$tab'} params={{ profile, tab: key }} search={{}}>
        {({ isActive }) => <span className={tab === key || isActive && key !== 'featured' ? 'channel-tab active' : 'channel-tab'}>{t(label)}</span>}
      </Link> : <Link key={key} to={key === 'featured' ? '/channel/$id' : '/channel/$id/$tab'} params={{ id: data.id, tab: key }} search={{}}>
        <span className={tab === key ? 'channel-tab active' : 'channel-tab'}>{t(label)}</span>
      </Link>)}</TabNav>
    {tab === 'about' ? <div className="about"><h2>{t('channelAbout')}</h2><p>{data.description || t('noChannelDescription')}</p></div>
      : tab === 'playlists' ? <>
        {lists.isLoading && <Loading />}
        {lists.error && <Notice error={lists.error} retry={() => void lists.refetch()} />}
        {lists.data?.pages[0].items.length === 0 && <Blank title={t('noPublicPlaylists')} description={t('browseChannelVideos')} kind="playlist" />}
        <div className="playlist-grid">{lists.data?.pages.flatMap(p => p.items).map(p => <PlaylistCard key={p.id} list={p} />)}</div>
        <LoadMore more={lists.hasNextPage} loading={lists.isFetchingNextPage} next={() => void lists.fetchNextPage()} />
      </> : <>
        <SyncLine kind="channel" id={data.id} status={videos.data?.pages[0].statuses[0] ?? query.data?.status} refetch={() => {
          void query.refetch(); void client.invalidateQueries({ queryKey: ['feed'] })
        }} />
        <FeedControls filters={filters} change={change} />
        <FeedItems query={videos} empty={t('noSyncedVideos')} />
      </>}
  </section>
}
function PlaylistCard({ list }: { list: Playlist }) {
  const { t } = useLocale()
  return <article className="playlist-card">
    <Link to="/playlist" search={{ list: list.id }} className="playlist-card-link">
      <div className="playlist-cover"><Cover url={list.thumbnail} /><span><ListVideo aria-hidden="true" />{t('videoCount', { count: list.count })}</span></div>
      <h2>{list.title}</h2>
      <p className="muted">{t('playlist')}</p>
      <span className="playlist-card-view muted">{t('viewFullPlaylist')}</span>
    </Link>
  </article>
}
export function PlaylistItems({ items, list, active }: { items: Item[]; list: string; active?: number }) {
  const { t, number } = useLocale()
  return <ol className="playlist-items">{items.map(item => <li key={item.itemId} className={active === item.position ? 'queue-current' : undefined}>
    <span className="item-position" aria-label={t('itemPosition', { position: item.position + 1 })}>{active === item.position ? <Play /> : number(item.position + 1)}</span>
    {item.video ? <Link {...videoLink(item.video.id, { list, index: item.position + 1 })} className="playlist-item-link" aria-current={active === item.position ? 'true' : undefined}>
      <Cover url={item.video.thumbnail} duration={item.video.duration} />
      <div><strong>{item.video.title}</strong><p className="muted">{item.video.channelTitle}</p>{!item.video.embeddable && <p className="muted">{t('embedUnavailable')}</p>}</div>
    </Link> : <div className="playlist-item-link unavailable"><Cover url="" /><div><strong>{t('videoUnavailable')}</strong><p className="muted">{t('positionPreserved')}</p></div></div>}
  </li>)}</ol>
}
export function PlaylistPage({ id }: { id?: string }) {
  const { t, errorText } = useLocale()
  const navigate = useNavigate()
  const query = useQuery({ ...sourceQuery('playlist', id), refetchInterval: q => q.state.data?.status?.complete === false && !q.state.data.status.error ? 60_000 : false })
  const list = query.data?.data as Playlist | undefined
  const firstPlayable = useMutation({ mutationFn: () => api<Item | null>('playlist-first', { id }) })
  const rows = useInfiniteQuery({
    queryKey: ['playlist', id, query.data?.status?.checked, query.data?.status?.count], enabled: !!list, initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => api<Page<Item>>('playlist', { id, cursor: pageParam }, signal),
    getNextPageParam: page => page.next,
  })
  if (!id) return <section className="page"><Notice title={t('invalidPlaylist')} /></section>
  if (query.isPending) return <section className="page"><Loading label={t('loadingPlaylist')} /></section>
  if (!list || query.error) return <section className="page"><Notice title={t('playlistOpenFailed')} error={query.error} retry={() => void query.refetch()} /></section>
  const items = rows.data?.pages.flatMap(p => p.items) ?? []
  const first = items.find(i => i.video?.embeddable)
  return <section className="page playlist-page">
    <aside className="playlist-intro">
      <Cover url={list.thumbnail} eager />
      <p className="eyebrow"><ListVideo /> {t('publicPlaylist')}</p>
      <h1>{list.title}</h1><ChannelLink id={list.channelId}>{list.channelTitle}</ChannelLink>
      <p className="muted">{t('videoCount', { count: list.count })}</p>
      <div className="playlist-actions">
        <Button disabled={(!first?.videoId && !rows.hasNextPage) || firstPlayable.isPending} onClick={async () => {
          try {
            const item = first ?? await firstPlayable.mutateAsync()
            if (!item?.videoId) { toast.info(t('noPlayableVideos')); return }
            const target = { v: item.videoId, list: id, index: item.position + 1 }
            void navigate({ to: '/watch', search: target, state: { playAll: armPlayback(target) } })
          } catch (e) { toast.error(errorText(e)) }
        }}><Play data-icon="inline-start" />{t('playAll')}</Button>
        <ToggleSource source={list} />
      </div>
      {list.description && <details className="list-description"><summary>{t('showDescription')}</summary><p>{list.description}</p></details>}
      <SyncLine kind="playlist" id={id} status={query.data?.status} refetch={() => { void query.refetch(); void rows.refetch() }} />
    </aside>
    <div className="playlist-body">
      <h2>{t('playlistVideos')}</h2>
      {rows.isLoading && <Loading />}
      {rows.error && <Notice error={rows.error} retry={() => void rows.refetch()} />}
      {!rows.isLoading && !rows.error && !items.length && <p className="muted">{t('noPlaylistItems')}</p>}
      <PlaylistItems items={items} list={id} />
      <LoadMore more={rows.hasNextPage} loading={rows.isFetchingNextPage} next={() => void rows.fetchNextPage()} />
    </div>
  </section>
}
