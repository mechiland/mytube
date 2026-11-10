import { ClientOnly, Link, Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider, useQueries } from '@tanstack/react-query'
import { Bookmark, Clock3, House, LibraryBig, ListVideo, Menu, Plus, Search, Settings2, TvMinimalPlay, X } from 'lucide-react'
import { createContext, lazy, Suspense, useContext, useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Toaster } from '@/components/ui/sonner'
import { defaultTheme, Theme } from '@/lib/theme/theme'
import { RequestError, sourceQuery } from '@/lib/client'
import { LibraryProvider, useLibrary } from '@/lib/personal'

import { ChannelAvatar, Notice } from './common'

function BrandMark() {
  return <span className="brand-mark"><svg viewBox="0 0 18 18" aria-hidden="true"><path d="M6 4.4v9.2l8-4.6z" fill="currentColor" /></svg></span>
}
const AddDialog = lazy(() => import('./add-dialog'))
const AddContext = createContext(() => {})

const sections = [
  { to: '/', icon: House, label: '首页' },
  { to: '/feed/subscriptions', icon: TvMinimalPlay, label: '订阅频道' },
  { to: '/feed/playlists', icon: ListVideo, label: '播放列表' },
  { to: '/feed/favorites', icon: Bookmark, label: '收藏' },
  { to: '/feed/history', icon: Clock3, label: '继续观看' },
  { to: '/settings', icon: Settings2, label: '设置' },
] as const
const makeClient = () => new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: (n, e) => n < 1 && e instanceof RequestError && ['network', 'busy'].includes(e.code) } },
})

const plumTheme = { ...defaultTheme, accentColor: 'plum', grayColor: 'auto' } as const
function ShellPlaceholder() {
  return <Theme config={plumTheme}>
    <div className="app-shell">
      <header className="topbar" aria-busy="true">
        <div className="brand-group"><span className="brand"><BrandMark /><span>mytube</span></span></div>
      </header>
      <main className="app-main" id="content" />
    </div>
  </Theme>
}
export function Providers() {
  const [client] = useState(makeClient)
  return <ClientOnly fallback={<ShellPlaceholder />}>
    <QueryClientProvider client={client}><LibraryProvider><Shell /></LibraryProvider></QueryClientProvider>
  </ClientOnly>
}
function Shell() {
  const location = useLocation()
  const navigate = useNavigate()
  const { state, error } = useLibrary()
  const [systemDark, setSystemDark] = useState(false)
  const [rail, setRail] = useState(true)
  const [mobile, setMobile] = useState(false)
  const [add, setAdd] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const queryText = typeof (location.search as Record<string, unknown>).search_query === 'string'
    ? String((location.search as Record<string, unknown>).search_query) : ''
  const [q, setQ] = useState(queryText)
  useEffect(() => { setQ(queryText) }, [queryText])
  useEffect(() => {
    const match = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemDark(match.matches)
    update()
    match.addEventListener('change', update)
    return () => match.removeEventListener('change', update)
  }, [])
  const dark = state.theme === 'dark' || (state.theme === 'system' && systemDark)
  function search(event: FormEvent) {
    event.preventDefault()
    setSearchOpen(false)
    void navigate({ to: '/results', search: { search_query: q.trim() } })
  }
  const watch = location.pathname === '/watch'
  return <Theme config={{ ...plumTheme, appearance: dark ? 'dark' : 'light' }}>
    <div className="app-shell" data-rail={rail} data-watch={watch}>
      <header className="topbar">
        <div className="brand-group">
          <Button variant="ghost" size="icon" aria-label="切换导航" onClick={() => {
            if (window.matchMedia('(max-width: 760px)').matches) setMobile(v => !v)
            else setRail(v => !v)
          }}><Menu /></Button>
          <Link to="/" className="brand" aria-label="mytube 首页"><BrandMark /><span>mytube</span></Link>
        </div>
        <form onSubmit={search} className={searchOpen ? 'top-search search-open' : 'top-search'} role="search">
          <InputGroup className="search-box">
            <InputGroupInput autoComplete="off" aria-label="搜索我的内容库" maxLength={120} placeholder="搜索我的内容库" value={q} onChange={e => setQ(e.target.value)} />
            <InputGroupAddon align="inline-end"><InputGroupButton type="submit" aria-label="搜索"><Search /></InputGroupButton></InputGroupAddon>
          </InputGroup>
        </form>
        <div className="top-actions">
          <Button variant="ghost" size="icon" className="mobile-search" aria-label="打开搜索" onClick={() => setSearchOpen(v => !v)}>{searchOpen ? <X /> : <Search />}</Button>
          <Button variant="soft" className="add-button" onClick={() => setAdd(true)}><Plus data-icon="inline-start" /><span>添加内容</span></Button>
          <Button variant="ghost" size="icon" className="header-settings" nativeButton={false} render={<Link to="/settings" aria-label="设置" />}><Settings2 /></Button>
        </div>
      </header>
      {mobile && <button className="nav-scrim" onClick={() => setMobile(false)} aria-label="关闭导航" />}
      <aside className={mobile ? 'sidebar mobile-open' : 'sidebar'}>
        <nav aria-label="内容库导航">
          <div className="nav-kicker"><LibraryBig />我的内容库</div>
          {sections.map(({ to, icon: Icon, label }) => <Link key={to} to={to} activeOptions={{ exact: true, includeSearch: false }}
            activeProps={{ className: 'nav-active' }} className="nav-item" title={label} onClick={() => setMobile(false)}><Icon /><span>{label}</span></Link>)}
        </nav>
        {rail && !watch && <SavedChannelShortcuts close={() => setMobile(false)} />}
        <div className="sidebar-note">个人内容库 <span>·</span> 仅此浏览器</div>
      </aside>
      <main className="app-main" id="content">
        {error && <Notice title="无法访问浏览器本地数据" error={new Error('请检查浏览器的站点存储权限。')} />}
        <AddContext.Provider value={() => setAdd(true)}><Outlet /></AddContext.Provider>
      </main>
    </div>
    {add && <Suspense fallback={null}><AddDialog open={add} setOpen={setAdd} /></Suspense>}
    <Toaster theme={dark ? 'dark' : 'light'} position="bottom-right" />
  </Theme>
}

function SavedChannelShortcuts({ close }: { close: () => void }) {
  const { state, ready } = useLibrary()
  const sources = useQueries({ queries: state.channels.slice(0, 6).map(id => ({ ...sourceQuery('channel', id), enabled: ready })) })
  const channels = sources.flatMap(result => result.data?.data.kind === 'channel' ? [result.data.data] : [])
  if (!channels.length) return null
  return <nav className="channel-shortcuts" aria-label="已订阅的频道">
    <div className="nav-kicker">已订阅</div>
    {channels.map(channel => <Link key={channel.id} to="/channel/$id" params={{ id: channel.id }} onClick={close} className="nav-item">
      <ChannelAvatar className="shortcut-avatar" name={channel.title} url={channel.thumbnail} /><span>{channel.title}</span>
    </Link>)}
  </nav>
}

export function OpenAdd({ children = '添加内容' }: { children?: string }) {
  const open = useContext(AddContext)
  return <Button onClick={open}><Plus data-icon="inline-start" />{children}</Button>
}
