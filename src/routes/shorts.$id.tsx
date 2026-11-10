import { createFileRoute, redirect, notFound } from '@tanstack/react-router'
import { videoId, watchSearch } from '@/lib/youtube-url'
export const Route = createFileRoute('/shorts/$id')({
  validateSearch: watchSearch,
  beforeLoad: ({ params, search }) => {
    if (!videoId(params.id)) throw notFound()
    throw redirect({ to: '/watch', search: { ...search, v: params.id }, replace: true })
  },
})
