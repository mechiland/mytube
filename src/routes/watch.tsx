import { createFileRoute, useLocation } from '@tanstack/react-router'
import { WatchPage } from '@/components/app/watch'
import { watchSearch } from '@/lib/youtube-url'
export const Route = createFileRoute('/watch')({
  validateSearch: watchSearch,
  component: function Watch() {
    const search = Route.useSearch()
    const token = useLocation({ select: location => location.state.playAll })
    return <WatchPage key={JSON.stringify([search, token])} search={search} />
  },
})
