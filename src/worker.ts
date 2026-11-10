import start from '@tanstack/react-start/server-entry'
import { runScheduled } from './server/sync'

export default {
  fetch(request) {
    const path = new URL(request.url).pathname.toLowerCase()
    if (path.startsWith('/.env') || path.startsWith('/.dev.vars')) return new Response(null, { status: 404 })
    if (path === '/api' || (path.startsWith('/api/') && !['GET', 'POST'].includes(request.method)))
      return Response.json({ error: 'input' }, { status: path === '/api' ? 404 : 405 })
    return start.fetch(request)
  },
  async scheduled(_controller, env) {
    await runScheduled(env)
  },
} satisfies ExportedHandler<Env>
