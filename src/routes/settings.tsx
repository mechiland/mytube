import { createFileRoute } from '@tanstack/react-router'
import { Download, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { Loading, Notice, videoLink } from '@/components/app/common'
import { Link } from '@tanstack/react-router'
import { emptyLibrary, MAX_BACKUP_BYTES, mergeLibrary, parseBackup, type Library } from '@/lib/library'
import { useLibrary } from '@/lib/personal'
import { useLocale } from '@/lib/i18n'
import { isLocale, languages } from '@/lib/locale'
import { MessageError } from '@/lib/message-error'

export const Route = createFileRoute('/settings')({ component: Settings })

function Settings() {
  const { t, number, preference, setPreference } = useLocale()
  const { state, ready, update } = useLibrary()
  const file = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<Library>()
  const [error, setError] = useState<Error>()
  const [clear, setClear] = useState(false)
  const [busy, setBusy] = useState(false)
  const merged = preview ? mergePreview(state, preview) : undefined
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `mytube-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  async function upload(value: File | undefined) {
    if (!value) return
    setError(undefined)
    setPreview(undefined)
    try {
      if (value.size > MAX_BACKUP_BYTES) throw new MessageError('backupTooLarge')
      const candidate = parseBackup(await value.text())
      mergeLibrary(state, candidate)
      setPreview(candidate)
    } catch (e) { setError(e instanceof SyntaxError ? new MessageError('backupInvalidJson') : e as Error) }
    finally { if (file.current) file.current.value = '' }
  }
  return <section className="page settings-page">
    <header className="page-heading"><h1>{t('settings')}</h1></header>
    {!ready ? <Loading /> : <>
      <section className="settings-section"><h2>{t('appearancePlayback')}</h2>
        <div className="settings-row"><label htmlFor="language">{t('language')}</label>
          <NativeSelect id="language" value={preference} onChange={e => {
            const value = e.target.value
            if (value === 'browser' || isLocale(value)) setPreference(value)
          }}>
            <NativeSelectOption value="browser">{t('browserLanguage')}</NativeSelectOption>
            {Object.entries(languages).map(([locale, name]) =>
              <NativeSelectOption key={locale} lang={locale} value={locale}>{name}</NativeSelectOption>)}
          </NativeSelect>
        </div>
        <div className="settings-row"><label htmlFor="theme">{t('theme')}</label><NativeSelect id="theme" value={state.theme} onChange={e => {
          const theme = e.target.value as Library['theme']
          void update(s => ({ ...s, theme }))
        }}><NativeSelectOption value="system">{t('systemTheme')}</NativeSelectOption><NativeSelectOption value="light">{t('lightTheme')}</NativeSelectOption><NativeSelectOption value="dark">{t('darkTheme')}</NativeSelectOption></NativeSelect></div>
        <label className="settings-row"><span>{t('loopPlayback')}</span><Switch checked={state.loop} onCheckedChange={loop => void update(s => ({ ...s, loop }))} /></label>
      </section>
      <section className="settings-section"><h2>{t('hiddenVideos')}</h2>
        {!state.hidden.length ? <p className="muted">{t('noHiddenVideos')}</p> : <>
          {state.hidden.slice(0, 30).map(id => <div className="settings-row" key={id}>
            <Link {...videoLink(id)}>{id}</Link><Button size="sm" variant="outline" onClick={async () => {
              if (await update(s => ({ ...s, hidden: s.hidden.filter(v => v !== id) }))) toast.success(t('videoRestored'))
            }}>{t('restoreVideo')}</Button>
          </div>)}
          {state.hidden.length > 30 && <Button variant="outline" onClick={async () => {
            if (await update(s => ({ ...s, hidden: [] }))) toast.success(t('allVideosRestored'))
          }}>{t('restoreAllVideos', { count: state.hidden.length })}</Button>}
        </>}
      </section>
      <section className="settings-section"><h2>{t('backupRestore')}</h2><p className="muted">{t('backupHelp')}</p>
        <div className="settings-buttons">
          <Button variant="outline" onClick={download}><Download data-icon="inline-start" />{t('exportJson')}</Button>
          <Button variant="outline" onClick={() => file.current?.click()}><Upload data-icon="inline-start" />{t('importJson')}</Button>
          <input ref={file} type="file" accept=".json,application/json" aria-label={t('chooseBackup')} className="sr-only" tabIndex={-1} onChange={e => void upload(e.target.files?.[0])} />
        </div>
        {error && <Notice title={t('importFailed')} error={error} />}
      </section>
      <section className="settings-section"><h2>{t('clearData')}</h2>
        <Button variant="destructive" onClick={() => setClear(true)}><Trash2 data-icon="inline-start" />{t('clearLocalData')}</Button>
      </section>
    </>}
    <Dialog open={!!preview} onOpenChange={open => { if (!open && !busy) setPreview(undefined) }}>
      <DialogContent><DialogHeader><DialogTitle>{t('mergePreview')}</DialogTitle><DialogDescription>{t('mergeHelp')}</DialogDescription></DialogHeader>
        {merged && <dl className="import-counts">{([
          ['subscriptions', 'channels'], ['playlists', 'playlists'], ['savedVideos', 'favorites'], ['hiddenVideos', 'hidden'],
        ] as const).map(([label, k]) => <div key={k}><dt>{t(label)}</dt><dd>+{number(merged[k].length - state[k].length)}</dd></div>)}
          <div><dt>{t('updatedProgress')}</dt><dd>{number(Object.entries(merged.progress).filter(([id, p]) => state.progress[id]?.updatedAt !== p.updatedAt).length)}</dd></div>
        </dl>}
        <DialogFooter><Button variant="ghost" onClick={() => setPreview(undefined)}>{t('cancel')}</Button><Button disabled={!merged || busy} onClick={async () => {
          if (!preview) return
          setBusy(true)
          if (await update(s => mergeLibrary(s, preview))) { toast.success(t('backupImported')); setPreview(undefined) }
          setBusy(false)
        }}>{t('confirmMerge')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={clear} onOpenChange={setClear}>
      <DialogContent><DialogHeader><DialogTitle>{t('clearConfirmTitle')}</DialogTitle>
        <DialogDescription>{t('clearConfirmHelp')}</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="ghost" onClick={() => setClear(false)}>{t('cancel')}</Button><Button variant="destructive" onClick={async () => {
          if (await update(emptyLibrary)) { toast.success(t('dataCleared')); setClear(false) }
        }}>{t('confirmClear')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>
}
function mergePreview(local: Library, imported: Library) {
  try { return mergeLibrary(local, imported) } catch { return undefined }
}
