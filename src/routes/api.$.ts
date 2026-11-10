import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { handleApi } from '../server/api'

export const Route = createFileRoute('/api/$')({
  server: { handlers: {
    GET: ({ request, params }) => handleApi(request, params._splat, env),
    POST: ({ request, params }) => handleApi(request, params._splat, env),
  } },
})
