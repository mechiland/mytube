import { createFileRoute } from '@tanstack/react-router'
import { PlaylistPage } from '@/components/app/browse'
import { playlistId } from '@/lib/youtube-url'
export const Route = createFileRoute('/playlist')({
  validateSearch: (s: Record<string, unknown>) => ({ list: playlistId(s.list) ? s.list : undefined }),
  component: () => <PlaylistPage id={Route.useSearch().list} />,
})
