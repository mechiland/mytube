import { createFileRoute, notFound } from '@tanstack/react-router'
import { ChannelPage, feedSearch } from '@/components/app/browse'
import { handle } from '@/lib/youtube-url'
export const Route = createFileRoute('/$profile')({
  beforeLoad: ({ params }) => { if (!handle(params.profile)) throw notFound() },
  validateSearch: feedSearch,
  component: function Profile() {
    const { profile } = Route.useParams()
    const filters = Route.useSearch()
    const navigate = Route.useNavigate()
    return <ChannelPage profile={profile} filters={filters} change={search => { void navigate({ search, resetScroll: false }) }} />
  },
})
