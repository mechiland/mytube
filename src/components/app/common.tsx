import { Link, type LinkProps } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ImageOff, RefreshCw, TriangleAlert } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { api, formatDuration, safeImage, sourceQuery } from '@/lib/client'
import type { Source, SourceKind, SyncStatus } from '@/lib/data'
import { saveSource, useLibrary } from '@/lib/personal'
import { useLocale } from '@/lib/i18n'

export function Notice({ error, title, retry }: { error?: Error | null; title?: string; retry?: () => void }) {
  const { t, errorText } = useLocale()
  return <Alert className="notice"><TriangleAlert /><AlertTitle>{title ?? t('loadFailed')}</AlertTitle>
    <AlertDescription>{errorText(error)}</AlertDescription>
    {retry && <Button variant="outline" size="sm" onClick={retry}>{t('retry')}</Button>}
  </Alert>
}
export function Loading({ label }: { label?: string }) {
  const { t } = useLocale()
  return <div className="loading" role="status"><Skeleton className="h-2 w-24" /><span>{label ?? t('loading')}</span></div>
}
export function Cover({ url, duration, eager }: { url: string; duration?: number; eager?: boolean }) {
  const src = safeImage(url)
  return <div className="cover">
    <ImageOff className="cover-fallback" aria-hidden="true" />
    {src && <img src={src} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" onError={e => { e.currentTarget.hidden = true }} />}
    {!!duration && <span className="duration">{formatDuration(duration)}</span>}
  </div>
}
export function ChannelAvatar({ name, url, className }: { name: string; url?: string; className?: string }) {
  return <Avatar className={className ? `app-avatar ${className}` : "app-avatar"}>{safeImage(url) && <AvatarImage src={safeImage(url)} alt="" />}
    <AvatarFallback>{[...name][0]?.toUpperCase() ?? '•'}</AvatarFallback>
  </Avatar>
}
export function ChannelLink({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return <Link className={className} to="/channel/$id" params={{ id }}>{children}</Link>
}
export function videoLink(id: string, context: { list?: string; index?: number; t?: string } = {}): LinkProps {
  return { to: '/watch', search: { v: id, ...context } }
}
export function ToggleSource({ source }: { source: Source }) {
  const { t } = useLocale()
  const { state, update } = useLibrary()
  const query = useQueryClient()
  const saved = (source.kind === 'channel' ? state.channels : state.playlists).includes(source.id)
  const text = source.kind === 'channel' ? (saved ? t('unsubscribe') : t('subscribe')) : (saved ? t('unsavePlaylist') : t('savePlaylist'))
  return <Button variant={saved ? 'soft' : 'solid'} onClick={async () => {
    if (await update(s => saveSource(s, source.kind, source.id, !saved))) {
      toast.success(saved ? t('removedLocal') : t('addedLocal'))
      if (!saved) void query.fetchQuery(sourceQuery(source.kind, source.id)).then(() => query.invalidateQueries({ queryKey: ['feed'] })).catch(() => {})
    }
  }}>{text}</Button>
}
export function SyncLine({ status, kind, id, refetch }: { status?: SyncStatus; kind: SourceKind; id: string; refetch: () => void }) {
  const { t, locale, apiError, errorText } = useLocale()
  const [busy, setBusy] = useState(false)
  let detail = t(status?.complete ? 'synced' : 'syncing')
  if (status?.error) {
    detail = apiError(status.error)
    if (status.complete) detail = t('syncPaused', { detail })
  }
  return <div className="sync-line">
    <span>{detail} · {t('syncCount', { count: status?.count ?? 0 })}{status?.checked && <> · {t('lastUpdated', { date: new Date(status.checked).toLocaleString(locale) })}</>}</span>
    <Button variant="ghost" size="sm" disabled={busy} onClick={async () => {
      setBusy(true)
      try {
        const result = await api<SyncStatus>('refresh', {}, undefined, { kind, id })
        refetch()
        if (result.error) toast.error(apiError(result.error))
        else toast.success(t('checkedUpdates'))
      } catch (e) { toast.error(errorText(e)) }
      finally { setBusy(false) }
    }}><RefreshCw data-icon="inline-start" />{busy ? t('checking') : t('checkUpdates')}</Button>
  </div>
}
