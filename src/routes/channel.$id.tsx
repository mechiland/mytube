import { createFileRoute, notFound } from '@tanstack/react-router'
import { ChannelPage, feedSearch } from '@/components/app/browse'
import { channelId } from '@/lib/youtube-url'
export const Route = createFileRoute('/channel/$id')({
  beforeLoad: ({ params }) => { if (!channelId(params.id)) throw notFound() },
  validateSearch: feedSearch,
  component: function Channel() {
    const { id } = Route.useParams()
    const filters = Route.useSearch()
    const navigate = Route.useNavigate()
    return <ChannelPage id={id} filters={filters} change={search => { void navigate({ search, resetScroll: false }) }} />
  },
})
