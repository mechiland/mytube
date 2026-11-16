import { dehydrate, QueryClient } from '@tanstack/react-query'
import { sourceQuery, videoQuery } from '../lib/client'
import type { Source, SourceKind, Video } from '../lib/data'
import { channelId, handle, playlistId, watchSearch } from '../lib/youtube-url'
import { nowMs, readCache, stmt, type Bindings } from './db'
import { feed, playlistPage, queueWindow, statuses } from './queries'

// Read public metadata only: SSR never starts a sync or waits for YouTube.
export async function publicPage(env: Bindings, url: URL) {
  const client = new QueryClient()
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const readSource = async (kind: SourceKind, id?: string, alias?: string, start = true) => {
    const row = await (id
      ? stmt(env, 'SELECT data FROM source WHERE kind=? AND id=? AND expires>?', kind, id, nowMs())
      : stmt(env, 'SELECT data FROM source WHERE kind=? AND alias=? AND expires>? LIMIT 1', kind, alias!.toLowerCase(), nowMs()))
      .first<string>('data')
    if (!row) return undefined
    const data = JSON.parse(row) as Source
    const status = (await statuses(env, kind === 'channel' ? [data.id] : [], kind === 'playlist' ? [data.id] : []))[0]
    // Keep the HTML immediately usable, then enroll/touch the source in the browser.
    client.setQueryData(sourceQuery(kind, id, alias, start).queryKey, { data, status }, { updatedAt: nowMs() - 120_000 })
    return { data, status }
  }
  const readVideo = async (id: string) => {
    const row = await stmt(env, 'SELECT data FROM video WHERE id=? AND expires>?', id, nowMs()).first<string>('data')
    if (!row) return undefined
    const data = JSON.parse(row) as Video
    client.setQueryData(videoQuery(id).queryKey, data)
    return data
  }
  try {
    if (parts.length === 1 && parts[0] === 'watch') {
      const search = watchSearch(Object.fromEntries(url.searchParams))
      if (!search.v) return dehydrate(client)
      const video = await readVideo(search.v)
      if (!video) return dehydrate(client)
      await Promise.all([
        readSource('channel', video.channelId, undefined, false),
        search.list ? (async () => {
          const list = await readSource('playlist', search.list)
          if (list) client.setQueryData(['queue', search.list, video.id, search.index, list.status?.count, list.status?.checked],
            await queueWindow(env, search.list!, video.id, search.index))
        })() : undefined,
      ])
    } else if (parts.length === 1 && parts[0] === 'playlist' && playlistId(url.searchParams.get('list'))) {
      const id = url.searchParams.get('list')!
      const list = await readSource('playlist', id)
      if (list) client.setQueryData(['playlist', id, list.status?.checked, list.status?.count], {
        pages: [await playlistPage(env, id)], pageParams: [undefined],
      })
    } else {
      const id = parts[0] === 'channel' && channelId(parts[1]) && parts.length <= 3 ? parts[1] : undefined
      const alias = handle(parts[0]) && parts.length <= 2 ? parts[0] : undefined
      const tab = parts[id ? 2 : 1] ?? 'featured'
      if ((!id && !alias) || !['featured', 'videos', 'playlists', 'about'].includes(tab)) return dehydrate(client)
      const source = await readSource('channel', id, alias)
      if (!source) return dehydrate(client)
      if (tab === 'featured' || tab === 'videos') {
        const input = { channels: [source.data.id], playlists: [], favorites: [], hidden: [], q: undefined,
          order: url.searchParams.get('order') === 'old' ? 'old' as const : 'new' as const }
        client.setQueryData(['feed', input], { pages: [await feed(env, input)], pageParams: [undefined] })
      } else if (tab === 'playlists') {
        const page = await readCache(env, `channel-lists:${source.data.id}:`)
        if (page) client.setQueryData(['channel-lists', source.data.id], { pages: [page], pageParams: [undefined] })
      }
    }
    return dehydrate(client)
  } finally {
    client.clear()
  }
}
