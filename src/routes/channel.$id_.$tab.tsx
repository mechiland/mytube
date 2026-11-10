import { createFileRoute, notFound } from '@tanstack/react-router'
import { ChannelPage, feedSearch, isChannelTab } from '@/components/app/browse'
import { channelId } from '@/lib/youtube-url'
export const Route = createFileRoute('/channel/$id_/$tab')({
  beforeLoad: ({ params }) => { if (!channelId(params.id) || !isChannelTab(params.tab)) throw notFound() },
  validateSearch: feedSearch,
  component: function ChannelSubPage() {
    const { id, tab } = Route.useParams()
    const filters = Route.useSearch()
    const navigate = Route.useNavigate()
    return <ChannelPage id={id} tab={isChannelTab(tab) ? tab : 'featured'} filters={filters} change={search => { void navigate({ search, resetScroll: false }) }} />
  },
})
