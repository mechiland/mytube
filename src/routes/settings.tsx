import { createFileRoute } from '@tanstack/react-router'
import { Download, HardDrive, Trash2, Upload } from 'lucide-react'
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

export const Route = createFileRoute('/settings')({ component: Settings })

function Settings() {
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
      if (value.size > MAX_BACKUP_BYTES) throw new Error('备份文件超过 500 KB。')
      const candidate = parseBackup(await value.text())
      mergeLibrary(state, candidate)
      setPreview(candidate)
    } catch (e) { setError(e instanceof SyntaxError ? new Error('备份文件不是有效的 JSON。') : e as Error) }
    finally { if (file.current) file.current.value = '' }
  }
  return <section className="page settings-page">
    <header className="page-heading"><p className="eyebrow"><HardDrive /> 仅此浏览器</p><h1>设置</h1>
      <p className="muted">收藏、订阅和播放记录保存在此浏览器。清除站点数据会删除这些记录。</p></header>
    {!ready ? <Loading /> : <>
      <section className="settings-section"><h2>外观和播放</h2>
        <div className="settings-row"><label htmlFor="theme">主题</label><NativeSelect id="theme" value={state.theme} onChange={e => {
          const theme = e.target.value as Library['theme']
          void update(s => ({ ...s, theme }))
        }}><NativeSelectOption value="system">跟随系统</NativeSelectOption><NativeSelectOption value="light">浅色</NativeSelectOption><NativeSelectOption value="dark">深色</NativeSelectOption></NativeSelect></div>
        <label className="settings-row"><span>连续播放到列表结尾时循环</span><Switch checked={state.loop} onCheckedChange={loop => void update(s => ({ ...s, loop }))} /></label>
      </section>
      <section className="settings-section"><h2>隐藏的视频</h2>
        {!state.hidden.length ? <p className="muted">没有隐藏的视频。</p> : <>
          {state.hidden.slice(0, 30).map(id => <div className="settings-row" key={id}>
            <Link {...videoLink(id)}>{id}</Link><Button size="sm" variant="outline" onClick={async () => {
              if (await update(s => ({ ...s, hidden: s.hidden.filter(v => v !== id) }))) toast.success('已恢复视频')
            }}>恢复显示</Button>
          </div>)}
          {state.hidden.length > 30 && <Button variant="outline" onClick={async () => {
            if (await update(s => ({ ...s, hidden: [] }))) toast.success('已恢复全部隐藏视频')
          }}>恢复全部 {state.hidden.length} 部视频</Button>}
        </>}
      </section>
      <section className="settings-section"><h2>备份和恢复</h2><p className="muted">备份包含此浏览器的 mytube 库和播放进度。导入时预览并去重合并。</p>
        <div className="settings-buttons">
          <Button variant="outline" onClick={download}><Download data-icon="inline-start" />导出 JSON</Button>
          <Button variant="outline" onClick={() => file.current?.click()}><Upload data-icon="inline-start" />导入 JSON</Button>
          <input ref={file} type="file" accept=".json,application/json" aria-label="选择备份文件" className="sr-only" tabIndex={-1} onChange={e => void upload(e.target.files?.[0])} />
        </div>
        {error && <Notice title="无法导入备份" error={error} />}
      </section>
      <section className="settings-section"><h2>清除数据</h2>
        <Button variant="destructive" onClick={() => setClear(true)}><Trash2 data-icon="inline-start" />清空本地个人数据</Button>
      </section>
    </>}
    <Dialog open={!!preview} onOpenChange={open => { if (!open && !busy) setPreview(undefined) }}>
      <DialogContent><DialogHeader><DialogTitle>预览合并</DialogTitle><DialogDescription>重合的条目会合并，播放进度保留最新的记录。</DialogDescription></DialogHeader>
        {merged && <dl className="import-counts">{([
          ['订阅频道', 'channels'], ['播放列表', 'playlists'], ['收藏视频', 'favorites'], ['隐藏视频', 'hidden'],
        ] as const).map(([label, k]) => <div key={k}><dt>{label}</dt><dd>+{merged[k].length - state[k].length}</dd></div>)}
          <div><dt>新增或更新的播放记录</dt><dd>{Object.entries(merged.progress).filter(([id, p]) => state.progress[id]?.updatedAt !== p.updatedAt).length}</dd></div>
        </dl>}
        <DialogFooter><Button variant="ghost" onClick={() => setPreview(undefined)}>取消</Button><Button disabled={!merged || busy} onClick={async () => {
          if (!preview) return
          setBusy(true)
          if (await update(s => mergeLibrary(s, preview))) { toast.success('已导入备份'); setPreview(undefined) }
          setBusy(false)
        }}>确认合并</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={clear} onOpenChange={setClear}>
      <DialogContent><DialogHeader><DialogTitle>清空此浏览器的 mytube 数据？</DialogTitle>
        <DialogDescription>这会删除所有订阅、收藏、隐藏状态、观看进度和设置。</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="ghost" onClick={() => setClear(false)}>取消</Button><Button variant="destructive" onClick={async () => {
          if (await update(emptyLibrary)) { toast.success('本地数据已清空'); setClear(false) }
        }}>确认清空</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>
}
function mergePreview(local: Library, imported: Library) {
  try { return mergeLibrary(local, imported) } catch { return undefined }
}
