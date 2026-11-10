import { createFileRoute } from '@tanstack/react-router'
import { feedSearch, LibraryFeed } from '@/components/app/browse'
export const Route = createFileRoute('/')({
  validateSearch: feedSearch,
  component: function Home() {
    const filters = Route.useSearch()
    const navigate = Route.useNavigate()
    return <LibraryFeed filters={filters} change={search => { void navigate({ search, resetScroll: false }) }} />
  },
})
