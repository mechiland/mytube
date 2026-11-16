import { Link, Outlet, useLocation } from '@tanstack/react-router'
import { hydrate, IsRestoringProvider, QueryClient, QueryClientProvider, useQueries, type DehydratedState } from '@tanstack/react-query'
import { Bookmark, Clock3, House, ListVideo, Menu, Plus, Search, Settings2, TvMinimalPlay } from 'lucide-react'
import { createContext, lazy, Suspense, useContext, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Toaster } from '@/components/ui/sonner'
import { defaultTheme, Theme } from '@/lib/theme/theme'
import { RequestError, sourceQuery } from '@/lib/client'
import { LibraryProvider, useLibrary } from '@/lib/personal'
import { useLocale } from '@/lib/i18n'
import { MessageError } from '@/lib/message-error'
import { persistQueryCache, restoreQueryCache } from '@/lib/query-cache'

import { ChannelAvatar, Notice } from './common'
import { LibrarySync } from './library-sync'

function BrandMark() {
  return <span className="brand-mark"><svg viewBox="0 0 18 18" aria-hidden="true"><path d="M6 4.4v9.2l8-4.6z" fill="currentColor" /></svg></span>
}
const AddDialog = lazy(() => import('./add-dialog'))
const SearchDialog = lazy(() => import('./search-dialog'))
const AddContext = createContext(() => {})
const TheaterContext = createContext<(active: boolean) => void>(() => {})

const sections = [
  { to: '/', icon: House, label: 'home' },
  { to: '/feed/subscriptions', icon: TvMinimalPlay, label: 'subscriptions' },
  { to: '/feed/playlists', icon: ListVideo, label: 'playlists' },
  { to: '/feed/favorites', icon: Bookmark, label: 'favorites' },
  { to: '/feed/history', icon: Clock3, label: 'continueWatching' },
  { to: '/settings', icon: Settings2, label: 'settings' },
] as const
const makeClient = () => new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: (n, e) => n < 1 && e instanceof RequestError && ['network', 'busy'].includes(e.code) } },
})

const plumTheme = { ...defaultTheme, accentColor: 'plum', grayColor: 'auto' } as const
export function Providers({ initialQueries }: { initialQueries?: DehydratedState | null }) {
  const [client] = useState(() => {
    const value = makeClient()
    if (initialQueries) hydrate(value, initialQueries)
    return value
  })
  const [restoring, setRestoring] = useState(true)
  useEffect(() => {
    let active = true
    let unsubscribe: (() => void) | undefined
    void restoreQueryCache(client).catch(() => {}).finally(() => {
      if (!active) return
      unsubscribe = persistQueryCache(client)
      setRestoring(false)
    })
    return () => { active = false; unsubscribe?.() }
  }, [client])
  return <QueryClientProvider client={client}><IsRestoringProvider value={restoring}>
    <LibraryProvider><Shell /><LibrarySync /></LibraryProvider>
  </IsRestoringProvider></QueryClientProvider>
}
function Shell() {
  const { t, dir } = useLocale()
  const location = useLocation()
  const { state, error } = useLibrary()
  const [systemDark, setSystemDark] = useState(false)
  const [rail, setRail] = useState(true)
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [theater, setTheater] = useState(false)
  const [add, setAdd] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [shortcut, setShortcut] = useState('Ctrl K')
  const searchTrigger = useRef<HTMLButtonElement>(null)
  const mobileSearchTrigger = useRef<HTMLButtonElement>(null)
  const navigationTrigger = useRef<HTMLButtonElement>(null)
  const queryText = typeof (location.search as Record<string, unknown>).search_query === 'string'
    ? String((location.search as Record<string, unknown>).search_query) : ''
  useEffect(() => {
    setNavigationOpen(false)
  }, [location.href])
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.repeat || event.altKey || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return
      if (!searchOpen && document.querySelector('[role="dialog"]')) return
      event.preventDefault()
      setSearchOpen(open => !open)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [searchOpen])
  useEffect(() => {
    setShortcut(/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K')
    const match = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemDark(match.matches)
    update()
    match.addEventListener('change', update)
    return () => match.removeEventListener('change', update)
  }, [])
  const dark = state.theme === 'dark' || (state.theme === 'system' && systemDark)
  const watch = location.pathname === '/watch'
  return <Theme config={{ ...plumTheme, appearance: dark ? 'dark' : 'light' }}>
    <div className="app-shell" data-rail={rail} data-watch={watch} data-theater={watch && theater}>
      <Theme className="topbar-theme" config={{ ...plumTheme, appearance: (watch && theater) || dark ? 'dark' : 'light' }}><header className="topbar">
        <div className="brand-group">
          <Button ref={navigationTrigger} variant="ghost" size="icon" aria-label={t('toggleNavigation')}
            aria-expanded={watch ? navigationOpen : undefined} onClick={() => {
            if (watch || window.matchMedia('(max-width: 760px)').matches) setNavigationOpen(v => !v)
            else setRail(v => !v)
          }}><Menu /></Button>
          <Link to="/" className="brand" aria-label={t('brandHome')}><BrandMark /><span>mytube</span></Link>
        </div>
        <Button ref={searchTrigger} variant="outline" className="top-search" aria-label={t('openSearch')} aria-haspopup="dialog" aria-expanded={searchOpen}
          aria-keyshortcuts="Meta+K Control+K" onClick={() => setSearchOpen(true)}>
          <Search data-icon="inline-start" /><span>{t('searchLibrary')}</span><kbd className="search-shortcut" aria-hidden="true">{shortcut}</kbd>
        </Button>
        <div className="top-actions">
          <Button ref={mobileSearchTrigger} variant="ghost" size="icon" className="mobile-search" aria-label={t('openSearch')} aria-haspopup="dialog" aria-expanded={searchOpen} onClick={() => setSearchOpen(true)}><Search /></Button>
          <Button variant="soft" className="add-button" aria-label={t('addContent')} onClick={() => setAdd(true)}><Plus data-icon="inline-start" /><span>{t('addContent')}</span></Button>
        </div>
      </header></Theme>
      {!watch && <aside className="sidebar">
        <LibraryNavigation close={() => setNavigationOpen(false)} />
        {rail && <SavedChannelShortcuts close={() => setNavigationOpen(false)} />}
      </aside>}
      <main className="app-main" id="content">
        {error && <Notice title={t('localDataUnavailable')} error={new MessageError('storagePermissions')} />}
        <TheaterContext.Provider value={setTheater}>
          <AddContext.Provider value={() => setAdd(true)}><Outlet /></AddContext.Provider>
        </TheaterContext.Provider>
      </main>
    </div>
    <Dialog open={navigationOpen} onOpenChange={setNavigationOpen}>
      <DialogContent className="navigation-drawer" showCloseButton={false} finalFocus={navigationTrigger}>
        <DialogTitle className="sr-only">{t('libraryNavigation')}</DialogTitle>
        <div className="navigation-drawer-header brand-group">
          <DialogClose render={<Button variant="ghost" size="icon" aria-label={t('closeNavigation')} />}><Menu /></DialogClose>
          <Link to="/" className="brand" aria-label={t('brandHome')} onClick={() => setNavigationOpen(false)}><BrandMark /><span>mytube</span></Link>
        </div>
        <div className="navigation-drawer-links">
          <LibraryNavigation close={() => setNavigationOpen(false)} />
          <SavedChannelShortcuts close={() => setNavigationOpen(false)} />
        </div>
      </DialogContent>
    </Dialog>
    {add && <Suspense fallback={null}><AddDialog open={add} setOpen={setAdd} /></Suspense>}
    {searchOpen && <Suspense fallback={null}><SearchDialog initialQuery={queryText} close={() => setSearchOpen(false)}
      returnFocus={() => window.matchMedia('(max-width: 760px)').matches ? mobileSearchTrigger.current : searchTrigger.current} /></Suspense>}
    <Toaster theme={dark ? 'dark' : 'light'} position={dir === 'rtl' ? 'bottom-left' : 'bottom-right'} dir={dir} containerAriaLabel={t('notifications')} />
  </Theme>
}

export function useTheaterHeader(active: boolean) {
  const setTheater = useContext(TheaterContext)
  useEffect(() => {
    setTheater(active)
    return () => setTheater(false)
  }, [active, setTheater])
}

function LibraryNavigation({ close }: { close: () => void }) {
  const { t } = useLocale()
  return <nav aria-label={t('libraryNavigation')}>
    {sections.map(({ to, icon: Icon, label }) => <Link key={to} to={to} activeOptions={{ exact: true, includeSearch: false }}
      activeProps={{ className: 'nav-active' }} className="nav-item" title={t(label)} onClick={close}><Icon /><span>{t(label)}</span></Link>)}
  </nav>
}

function SavedChannelShortcuts({ close }: { close: () => void }) {
  const { t } = useLocale()
  const { state, ready } = useLibrary()
  const sources = useQueries({ queries: state.channels.slice(0, 6).map(id => ({ ...sourceQuery('channel', id), enabled: ready })) })
  const channels = sources.flatMap(result => result.data?.data.kind === 'channel' ? [result.data.data] : [])
  if (!channels.length) return null
  return <nav className="channel-shortcuts" aria-label={t('subscribedChannels')}>
    <div className="nav-kicker">{t('subscribed')}</div>
    {channels.map(channel => <Link key={channel.id} to="/channel/$id" params={{ id: channel.id }} onClick={close} className="nav-item">
      <ChannelAvatar className="shortcut-avatar" name={channel.title} url={channel.thumbnail} /><span>{channel.title}</span>
    </Link>)}
  </nav>
}

export function OpenAdd({ children }: { children?: string }) {
  const { t } = useLocale()
  const open = useContext(AddContext)
  return <Button onClick={open}><Plus data-icon="inline-start" />{children ?? t('addContent')}</Button>
}
