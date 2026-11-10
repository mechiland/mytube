// Tokens live only in this document. History restoration and reload cannot replay a gesture.
type Target = { v: string; list: string; index?: number }
const gestures = new Map<string, { when: number; target: Target }>()
export function armPlayback(target: Target) {
  const token = crypto.randomUUID()
  if (gestures.size > 16) gestures.clear()
  gestures.set(token, { when: Date.now(), target })
  return token
}
export function consumePlayback(token: string | undefined, target: Target) {
  if (!token) return false
  const gesture = gestures.get(token)
  if (!gesture) return false
  const expires = Date.now() - gesture.when >= 30_000
  const matches = gesture.target.v === target.v && gesture.target.list === target.list && gesture.target.index === target.index
  if (expires || matches) gestures.delete(token)
  return matches && !expires
}
declare module '@tanstack/react-router' {
  interface HistoryState { playAll?: string }
}

type Player = {
  destroy: () => void; getCurrentTime: () => number; getDuration: () => number
}
type PlayerOptions = {
  events: {
    onReady: (event: { target: Player }) => void
    onStateChange: (event: { target: Player; data: number }) => void
    onError: (event: { data: number }) => void
    onAutoplayBlocked: () => void
  }
}
type YouTube = { Player: new (element: HTMLIFrameElement, options: PlayerOptions) => Player }
declare global { interface Window { YT?: YouTube; onYouTubeIframeAPIReady?: () => void } }
let api: Promise<YouTube> | undefined
export function playerApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (api) return api
  api = new Promise<YouTube>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.async = true
    const cleanup = () => {
      clearTimeout(timeout)
      script.onerror = null
      window.onYouTubeIframeAPIReady = previous
    }
    const fail = () => { cleanup(); script.remove(); reject(new Error('无法加载 YouTube 播放器 API。')) }
    const timeout = window.setTimeout(fail, 11_000)
    window.onYouTubeIframeAPIReady = () => {
      cleanup()
      previous?.()
      if (window.YT?.Player) resolve(window.YT)
      else fail()
    }
    script.onerror = fail
    document.head.appendChild(script)
  }).catch((e: unknown) => { api = undefined; throw e })
  return api
}
