import { createFileRoute } from '@tanstack/react-router'
import { LibraryFeed, feedSearch } from '@/components/app/browse'
export const Route = createFileRoute('/feed/favorites')({
  validateSearch: feedSearch,
  component: function Favorites() {
    const filters = Route.useSearch()
    const navigate = Route.useNavigate()
    return <LibraryFeed mode="favorites" filters={filters} change={search => { void navigate({ search, resetScroll: false }) }} />
  },
})
