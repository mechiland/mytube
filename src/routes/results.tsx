import { createFileRoute } from '@tanstack/react-router'
import { LibraryFeed, resultsSearch } from '@/components/app/browse'
export const Route = createFileRoute('/results')({
  validateSearch: resultsSearch,
  component: function Results() {
    const { search_query, ...filters } = Route.useSearch()
    const navigate = Route.useNavigate()
    return <LibraryFeed mode="results" q={search_query} filters={filters} change={search => { void navigate({ search: { ...search, search_query }, resetScroll: false }) }} />
  },
})
