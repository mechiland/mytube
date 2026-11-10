import { ExternalLink, Play, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { formatDuration } from '@/lib/client'
import type { Video } from '@/lib/data'
import type { Progress } from '@/lib/library'
import { playerApi } from '@/lib/playback'
import { useLocale } from '@/lib/i18n'
import type { Locale } from '@/lib/locale'
import type { MessageKey } from '@/lib/message-error'
import { Cover } from './common'

type Start = { at: number; requested: number; locale: Locale }
export function Player({ video, resume, time, auto, onProgress, onEnded, external }: {
  video: Video; resume?: Progress; time?: number; auto: boolean; onProgress: (p: Progress) => void; onEnded: () => void; external: string
}) {
  const { t, locale } = useLocale()
  const [start, setStart] = useState<Start>()
  const [error, setError] = useState<MessageKey>()
  const [blocked, setBlocked] = useState(false)
  const host = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onProgress, onEnded })
  useEffect(() => { callbacks.current = { onProgress, onEnded } }, [onProgress, onEnded])
  const nearEnd = !!resume && resume.duration - resume.at < Math.min(20, resume.duration * .08)
  const saved = !nearEnd && resume && resume.at > 3 ? resume.at : 0
  const duration = video.duration
  const initial = time === undefined ? saved : duration > 0 && time >= duration ? 0 : time
  function play(at: number) {
    setError(undefined)
    setBlocked(false)
    setStart({ at: Math.floor(at), requested: performance.now(), locale })
  }
  useEffect(() => {
    if (auto && video.embeddable) play(0)
  }, [auto, video.embeddable])

  useEffect(() => {
    const parent = host.current
    if (!start || !parent) return
    let active = true
    let player: Awaited<ReturnType<typeof playerApi>> extends { Player: new (...args: never[]) => infer P } ? P : never
    let last = -1
    let recorded = false
    let playing = false
    const iframe = document.createElement('iframe')
    const query = new URLSearchParams({ autoplay: '1', playsinline: '1', enablejsapi: '1', rel: '0', origin: window.location.origin, start: String(start.at), hl: start.locale })
    iframe.src = `https://www.youtube-nocookie.com/embed/${video.id}?${query}`
    iframe.title = video.title
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share'
    iframe.allowFullscreen = true
    iframe.referrerPolicy = 'strict-origin-when-cross-origin'
    parent.appendChild(iframe)
    const deadline = window.setTimeout(() => {
      if (active) setError('playerTimeout')
    }, 15_000)
    function snapshot(force = false) {
      try {
        const at = player?.getCurrentTime()
        const duration = player?.getDuration()
        if (typeof at !== 'number' || typeof duration !== 'number' || !Number.isFinite(at) || !Number.isFinite(duration) || at < 0 || duration <= 0) return
        if (playing && !recorded && at > start!.at + .08) {
          recorded = true
          performance.measure('mytube-playback-progress', { start: start!.requested, end: performance.now() })
        }
        if (!recorded && !playing) return
        if (force || Math.abs(at - last) >= 5) {
          last = at
          callbacks.current.onProgress({ at: Math.min(at, duration), duration, updatedAt: Date.now() })
        }
      } catch { /* The iframe may have navigated or already closed. */ }
    }
    const timer = window.setInterval(() => { if (playing) snapshot() }, 800)
    const save = () => snapshot(true)
    window.addEventListener('pagehide', save)
    void playerApi().then(YT => {
      if (!active) return
      player = new YT.Player(iframe, {
        events: {
          onReady: () => { if (active) clearTimeout(deadline) },
          onStateChange: ({ data }) => {
            if (!active) return
            if (data === 1) { playing = true; setBlocked(false); snapshot() }
            else if (data === 2 || data === 0) { snapshot(true); playing = false }
            if (data === 0) callbacks.current.onEnded()
          },
          onError: ({ data }) => {
            if (!active) return
            clearTimeout(deadline)
            const messages: Partial<Record<number, MessageKey>> = {
              2: 'playerInvalid', 5: 'playerUnsupported', 100: 'playerUnavailable',
              101: 'playerEmbedDenied', 150: 'playerEmbedDenied', 153: 'playerOrigin',
            }
            setError(messages[data] ?? 'playerFailed')
          },
          onAutoplayBlocked: () => { if (active) setBlocked(true) },
        },
      })
    }).catch(() => { if (active) { clearTimeout(deadline); setError('playerSyncFailed') } })
    return () => {
      active = false
      clearTimeout(deadline)
      clearInterval(timer)
      window.removeEventListener('pagehide', save)
      snapshot(true)
      try { player?.destroy() } catch { /* The frame is removed below. */ }
      iframe.remove()
    }
  }, [start, video.id, video.title])
  return <>
    <div className="player" role="region" aria-label={t('videoPlayer')}>
      {start ? <div ref={host} className="player-host" /> : <>
        <Cover url={video.thumbnail} eager />
        {video.embeddable && <Button className="play-button" size="icon-lg" aria-label={t('playVideo')} onClick={() => play(initial)}><Play fill="currentColor" /></Button>}
      </>}
    </div>
    {(!video.embeddable || error || blocked || (!start && (initial > 0 || nearEnd))) && <div className="player-feedback" role="status">
      {!video.embeddable ? t('videoCannotEmbed') : error ? t(error) : (blocked ? t('autoplayBlocked') : initial > 0 ? t('resumeAt', { time: formatDuration(initial) }) : t('restartAfterEnd'))}
      {video.embeddable && error && <Button size="sm" variant="outline" onClick={() => play(initial)}>{t('retryPlayback')}</Button>}
      {video.embeddable && !start && initial > 0 && <Button size="sm" variant="ghost" onClick={() => play(0)}><RotateCcw data-icon="inline-start" />{t('playFromStart')}</Button>}
      {(!video.embeddable || error) && <Button variant="ghost" size="sm" nativeButton={false} render={<a href={external} target="_blank" rel="noopener" />}><ExternalLink data-icon="inline-start" />{t('openOnYouTube')}</Button>}
    </div>}
  </>
}
