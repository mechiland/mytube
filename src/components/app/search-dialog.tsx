import { useNavigate } from '@tanstack/react-router'
import { ArrowUpRight, CornerDownLeft, Search, SearchX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Command, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import { useLocale } from '@/lib/i18n'
import { useLibrary } from '@/lib/personal'
import { useFeed } from './browse'
import { Notice, VideoCover, videoLink } from './common'

export default function SearchDialog({ initialQuery, close, returnFocus }: {
  initialQuery: string; close: () => void; returnFocus: () => HTMLElement | null
}) {
  const { t } = useLocale()
  return <Dialog open onOpenChange={open => { if (!open) close() }}>
    <DialogContent className="search-dialog" finalFocus={returnFocus}>
      <DialogTitle className="sr-only">{t('searchLibrary')}</DialogTitle>
      <DialogDescription className="sr-only">{t('searchHelp')}</DialogDescription>
      <SearchContent initialQuery={initialQuery} close={close} />
    </DialogContent>
  </Dialog>
}

function SearchContent({ initialQuery, close }: { initialQuery: string; close: () => void }) {
  const { t } = useLocale()
  const { ready, state } = useLibrary()
  const navigate = useNavigate()
  const [input, setInput] = useState(initialQuery)
  const [search, setSearch] = useState('')
  const [composing, setComposing] = useState(false)
  const term = input.trim()
  useEffect(() => {
    if (composing) return
    const timer = window.setTimeout(() => setSearch(term), 180)
    return () => window.clearTimeout(timer)
  }, [term, composing])
  const query = useFeed({ q: search, enabled: !!search && search === term && !composing })
  const loading = !!term && (!ready || term !== search || composing || query.isLoading)
  const items = !term || loading ? [] : [...new Map((query.data?.pages.flatMap(page => page.items) ?? []).map(video => [video.id, video])).values()]
  const error = term && !loading ? query.error : null
  const empty = !!term && !loading && !error && !items.length
  return <Command label={t('searchLibrary')} shouldFilter={false} loop>
    <CommandInput autoFocus aria-label={t('searchLibrary')} placeholder={t('searchLibrary')} autoComplete="off" maxLength={120}
      value={input} onValueChange={setInput} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} />
    <CommandList label={t('search')} aria-busy={loading}>
      {!term && <p className="search-status">{t('searchHelp')}</p>}
      {loading && <div className="search-status" role="status"><Spinner aria-hidden="true" role={undefined} />{t('loadingSyncedVideos')}</div>}
      {error && <Notice error={error} retry={() => void query.refetch()} />}
      {empty && <Empty className="search-empty">
        <EmptyHeader><EmptyMedia variant="icon"><SearchX /></EmptyMedia><EmptyTitle>{t('noSearchResults')}</EmptyTitle></EmptyHeader>
      </Empty>}
      {!!items.length && <CommandGroup heading={t('librarySearch')}>
        {items.map(video => <CommandItem key={video.id} value={video.id} className="search-result" onSelect={() => {
          close()
          void navigate(videoLink(video.id, state.contexts[video.id]))
        }}>
          <VideoCover video={video} duration={video.duration} />
          <span className="search-result-copy"><span className="search-result-title">{video.title}</span><span className="search-result-channel">{video.channelTitle}</span></span>
          <CommandShortcut><CornerDownLeft aria-hidden="true" /></CommandShortcut>
        </CommandItem>)}
        {query.hasNextPage && <CommandItem value="load-more" disabled={query.isFetchingNextPage} onSelect={() => { void query.fetchNextPage() }}>
          <Search /><span>{t('loadMore')}</span>
        </CommandItem>}
      </CommandGroup>}
      {empty && <CommandGroup>
        <CommandItem value="youtube" className="search-youtube" onSelect={() => {
          window.open(`https://www.youtube.com/results?${new URLSearchParams({ search_query: term })}`, '_blank', 'noopener,noreferrer')
        }}>
          <Search /><span className="search-result-copy"><span>{t('searchOnYouTube')}</span><span className="search-result-channel">{term}</span></span>
          <CommandShortcut><ArrowUpRight aria-hidden="true" /></CommandShortcut>
        </CommandItem>
      </CommandGroup>}
    </CommandList>
    <div className="search-footer"><span>{t('librarySearch')}</span><span aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd><kbd>↵</kbd></span></div>
  </Command>
}
