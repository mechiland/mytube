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
import { errors, type Source, type SourceKind, type SyncStatus } from '@/lib/data'
import { saveSource, useLibrary } from '@/lib/personal'

export function Notice({ error, title, retry }: { error?: Error | null; title?: string; retry?: () => void }) {
  return <Alert className="notice"><TriangleAlert /><AlertTitle>{title ?? '暂时无法加载'}</AlertTitle>
    <AlertDescription>{error?.message ?? '请检查链接后重试。'}</AlertDescription>
    {retry && <Button variant="outline" size="sm" onClick={retry}>重试</Button>}
  </Alert>
}
export function Loading({ label = '正在加载…' }: { label?: string }) {
  return <div className="loading" role="status"><Skeleton className="h-2 w-24" /><span>{label}</span></div>
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
  const { state, update } = useLibrary()
  const query = useQueryClient()
  const saved = (source.kind === 'channel' ? state.channels : state.playlists).includes(source.id)
  const text = source.kind === 'channel' ? (saved ? '已订阅 · 移除' : '订阅') : (saved ? '已保存 · 移除' : '保存播放列表')
  return <Button variant={saved ? 'soft' : 'solid'} onClick={async () => {
    if (await update(s => saveSource(s, source.kind, source.id, !saved))) {
      toast.success(saved ? '已从本地内容库移除' : '已添加到本地内容库')
      if (!saved) void query.fetchQuery(sourceQuery(source.kind, source.id)).then(() => query.invalidateQueries({ queryKey: ['feed'] })).catch(() => {})
    }
  }}>{text}</Button>
}
export function SyncLine({ status, kind, id, refetch }: { status?: SyncStatus; kind: SourceKind; id: string; refetch: () => void }) {
  const [busy, setBusy] = useState(false)
  const detail = status?.error ? (status.complete ? '更新暂缓 · ' : '') + (errors[status.error] ?? errors.service) : status?.complete ? '已同步' : '正在分批同步'
  return <div className="sync-line">
    <span>{detail} · {status?.count ?? 0} 条{status?.checked ? ` · 更新于 ${new Date(status.checked).toLocaleString('zh-CN')}` : ''}</span>
    <Button variant="ghost" size="sm" disabled={busy} onClick={async () => {
      setBusy(true)
      try {
        const result = await api<SyncStatus>('refresh', {}, undefined, { kind, id })
        refetch()
        if (result.error) toast.error(errors[result.error] ?? errors.service)
        else toast.success('已检查来源更新')
      } catch (e) { toast.error((e as Error).message) }
      finally { setBusy(false) }
    }}><RefreshCw data-icon="inline-start" />{busy ? '检查中…' : '检查更新'}</Button>
  </div>
}
