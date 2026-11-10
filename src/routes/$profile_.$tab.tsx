import { createFileRoute, notFound } from '@tanstack/react-router'
import { ChannelPage, feedSearch, isChannelTab } from '@/components/app/browse'
import { handle } from '@/lib/youtube-url'
export const Route = createFileRoute('/$profile_/$tab')({
  beforeLoad: ({ params }) => { if (!handle(params.profile) || !isChannelTab(params.tab)) throw notFound() },
  validateSearch: feedSearch,
  component: function ProfileSubPage() {
    const { profile, tab } = Route.useParams()
    const filters = Route.useSearch()
    const navigate = Route.useNavigate()
    return <ChannelPage profile={profile} tab={isChannelTab(tab) ? tab : 'featured'} filters={filters} change={search => { void navigate({ search, resetScroll: false }) }} />
  },
})
