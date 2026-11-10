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
import { useLocale } from '@/lib/i18n'
import { ChannelAvatar, Cover, Notice } from './common'

type Preview = { target: Target; value: Source | Video }
export default function AddDialog({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const { t } = useLocale()
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
      if (existing.includes(id)) { toast.info(t('alreadyInLibrary')); return }
      const saved = await update(s => kind === 'video' ? saveFavorite(s, id, true, target.kind === 'video'
        ? { list: target.list, index: target.index, t: target.time === undefined ? undefined : `${target.time}s` } : undefined) : saveSource(s, kind, id, true))
      if (!saved) return
      toast.success(t('addedToLibrary'))
      setOpen(false)
      setUrl('')
      reset()
      if (kind !== 'video') void client.fetchQuery(sourceQuery(kind, id)).then(() => client.invalidateQueries({ queryKey: ['feed'] })).catch(() => {})
    } catch (e) { setValidation(e as Error) }
    finally { setSaving(false) }
  }
  return <Dialog open={open} onOpenChange={setOpen}><DialogContent>
    <DialogHeader><DialogTitle>{t('addToMyLibrary')}</DialogTitle><DialogDescription>{t('pasteYouTubeLink')}</DialogDescription></DialogHeader>
    <form onSubmit={submit} className="add-form">
      <FieldGroup><Field><FieldLabel htmlFor="youtube-url">{t('youtubeLink')}</FieldLabel>
        <Input id="youtube-url" type="text" dir="ltr" inputMode="url" autoComplete="off" placeholder="https://www.youtube.com/…" value={url}
          maxLength={2048} onChange={e => { setUrl(e.target.value); reset() }} /></Field></FieldGroup>
      <Button type="submit" variant="outline" disabled={!url.trim() || lookup.isPending || saving} loading={lookup.isPending}>{t('checkYouTubeLink')}</Button>
    </form>
    {(validation || lookup.error) && <Notice title={t('addFailed')} error={validation ?? lookup.error} retry={lookup.error ? () => lookup.mutate(url.trim(), { onSuccess: setPreview }) : undefined} />}
    {preview && <div className="add-preview">
      {preview.value.kind === 'channel' ? <ChannelAvatar name={preview.value.title} url={preview.value.thumbnail} className="preview-avatar" /> : <Cover url={preview.value.thumbnail} />}
      <div><div className="muted">{preview.value.kind === 'channel' ? t('channel') : preview.value.kind === 'playlist' ? t('publicPlaylist') : t('singleVideo')}</div><strong>{preview.value.title}</strong></div>
    </div>}
    {preview && <DialogFooter>
      {preview.target.kind === 'video' && preview.target.list && <Button variant="outline" disabled={saving} onClick={() => void save(true)}>{t('saveWholePlaylist')}</Button>}
      <Button disabled={saving} loading={saving} onClick={() => void save()}>{preview.value.kind === 'video' ? t('saveThisVideo') : t('addToLibrary')}</Button>
    </DialogFooter>}
  </DialogContent></Dialog>
}
