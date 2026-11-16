import start from '@tanstack/react-start/server-entry'
import { WorkerEntrypoint } from 'cloudflare:workers'
import { runScheduled } from './server/sync'

// Only rendered documents opt into Workers Cache. Static Assets keep their direct path.
export class PageRenderer extends WorkerEntrypoint<Env> {
  async fetch(request: Request) {
    const rendered = await start.fetch(request)
    const response = new Response(rendered.body, rendered)
    if (!['GET', 'HEAD'].includes(request.method) || response.status !== 200 || !response.headers.get('content-type')?.includes('text/html')
      || !response.headers.has('Cache-Control')) {
      response.headers.set('Cache-Control', 'no-store')
      response.headers.delete('Cloudflare-CDN-Cache-Control')
    }
    response.headers.set('X-Content-Type-Options', 'nosniff')
    return response
  }
}

export default {
  fetch(request, _env, ctx) {
    const path = new URL(request.url).pathname.toLowerCase()
    if (path.startsWith('/.env') || path.startsWith('/.dev.vars')) return new Response(null, { status: 404 })
    if (path === '/api' || (path.startsWith('/api/') && !['GET', 'POST'].includes(request.method)))
      return Response.json({ error: 'input' }, { status: path === '/api' ? 404 : 405 })
    if (path.startsWith('/api/') || path.startsWith('/_serverfn/')) return start.fetch(request)
    return ctx.exports.PageRenderer.fetch(request)
  },
  async scheduled(_controller, env) {
    await runScheduled(env)
  },
} satisfies ExportedHandler<Env>
