import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { api, sourceQuery } from '@/lib/client'
import type { Source, Video } from '@/lib/data'
import { saveFavorite, saveSource, useLibrary } from '@/lib/personal'
import { parseYouTube, type Target } from '@/lib/youtube-url'
import { ChannelAvatar, Cover, Notice } from './common'

type Preview = { target: Target; value: Source | Video }
export default function AddDialog({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const [url, setUrl] = useState('')
  const [preview, setPreview] = useState<Preview>()
  const [validation, setValidation] = useState<Error>()
  const [saving, setSaving] = useState(false)
  const { state, update } = useLibrary()
  const client = useQueryClient()
  const lookup = useMutation({ mutationFn: (value: string) => api<Preview>('resolve', { url: value }) })
  function reset() { setPreview(undefined); setValidation(undefined); lookup.reset() }
  function submit(event: FormEvent) {
    event.preventDefault()
    reset()
    try { parseYouTube(url) } catch (e) { setValidation(e as Error); return }
    lookup.mutate(url.trim(), { onSuccess: setPreview })
  }
  async function save(whole = false) {
    if (!preview || saving) return
    setSaving(true)
    try {
      let { value } = preview
      const { target } = preview
      if (whole && target.kind === 'video' && target.list) {
        value = (await client.fetchQuery(sourceQuery('playlist', target.list, undefined, false))).data
      }
      const id = value.id
      const kind = value.kind
      const existing = kind === 'video' ? state.favorites : kind === 'channel' ? state.channels : state.playlists
      if (existing.includes(id)) { toast.info('此内容已在你的库中'); return }
      const saved = await update(s => kind === 'video' ? saveFavorite(s, id, true, target.kind === 'video'
        ? { list: target.list, index: target.index, t: target.time === undefined ? undefined : `${target.time}s` } : undefined) : saveSource(s, kind, id, true))
      if (!saved) return
      toast.success('已添加到我的内容库')
      setOpen(false)
      setUrl('')
      reset()
      if (kind !== 'video') void client.fetchQuery(sourceQuery(kind, id)).then(() => client.invalidateQueries({ queryKey: ['feed'] })).catch(() => {})
    } catch (e) { setValidation(e as Error) }
    finally { setSaving(false) }
  }
  return <Dialog open={open} onOpenChange={setOpen}><DialogContent>
    <DialogHeader><DialogTitle>添加到我的内容库</DialogTitle><DialogDescription>粘贴一个 YouTube 频道、视频或公开播放列表链接。</DialogDescription></DialogHeader>
    <form onSubmit={submit} className="add-form">
      <FieldGroup><Field><FieldLabel htmlFor="youtube-url">YouTube 链接</FieldLabel>
        <Input id="youtube-url" type="text" inputMode="url" autoComplete="off" placeholder="https://www.youtube.com/…" value={url}
          maxLength={2048} onChange={e => { setUrl(e.target.value); reset() }} /></Field></FieldGroup>
      <Button type="submit" variant="outline" disabled={!url.trim() || lookup.isPending || saving} loading={lookup.isPending}>解析链接</Button>
    </form>
    {(validation || lookup.error) && <Notice title="无法添加" error={validation ?? lookup.error} retry={lookup.error ? () => lookup.mutate(url.trim(), { onSuccess: setPreview }) : undefined} />}
    {preview && <div className="add-preview">
      {preview.value.kind === 'channel' ? <ChannelAvatar name={preview.value.title} url={preview.value.thumbnail} className="preview-avatar" /> : <Cover url={preview.value.thumbnail} />}
      <div><div className="muted">{preview.value.kind === 'channel' ? '频道' : preview.value.kind === 'playlist' ? '公开播放列表' : '单条视频'}</div><strong>{preview.value.title}</strong></div>
    </div>}
    {preview && <DialogFooter>
      {preview.target.kind === 'video' && preview.target.list && <Button variant="outline" disabled={saving} onClick={() => void save(true)}>保存整个播放列表</Button>}
      <Button disabled={saving} loading={saving} onClick={() => void save()}>{preview.value.kind === 'video' ? '只保存此视频' : '加入内容库'}</Button>
    </DialogFooter>}
  </DialogContent></Dialog>
}
