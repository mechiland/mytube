import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { openDB, type DBSchema } from 'idb'
import { toast } from 'sonner'
import { emptyLibrary, MAX_PERSONAL, validateLibrary, type Library, type Progress, type WatchContext } from './library'
import type { SourceKind } from './data'
import { useLocale } from './i18n'
import { MessageError } from './message-error'

interface PersonalDB extends DBSchema { library: { key: string; value: Library } }
let connection: ReturnType<typeof openDB<PersonalDB>> | undefined
const database = () => connection ??= openDB<PersonalDB>('mytube', 1, {
  upgrade: db => db.createObjectStore('library'),
  terminated: () => { connection = undefined },
}).catch((e: unknown) => { connection = undefined; throw e })
const key = 'personal'

type Edit = (value: Library) => Library
const LibraryContext = createContext<{
  state: Library; ready: boolean; error: boolean; update: (edit: Edit) => Promise<boolean>
} | null>(null)
export function LibraryProvider({ children }: { children: ReactNode }) {
  const { t } = useLocale()
  const [state, setState] = useState(emptyLibrary)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(false)
  const channel = useRef<BroadcastChannel | null>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const saved = await (await database()).get('library', key)
        if (alive && saved) setState(validateLibrary(saved))
      } catch { if (alive) setError(true) }
      finally { if (alive) setReady(true) }
    }
    if ('BroadcastChannel' in window) {
      channel.current = new BroadcastChannel('mytube-library')
      channel.current.onmessage = () => { void load() }
    }
    void load()
    return () => { alive = false; channel.current?.close(); channel.current = null }
  }, [])

  async function update(edit: Edit) {
    try {
      const db = await database()
      const tx = db.transaction('library', 'readwrite')
      const stored = await tx.store.get(key)
      const next = validateLibrary(edit(stored ? validateLibrary(stored) : emptyLibrary()))
      await tx.store.put(next, key)
      await tx.done
      setState(next)
      channel.current?.postMessage('changed')
      return true
    } catch (e) {
      toast.error(t(e instanceof MessageError && e.messageKey === 'backupInvalid' ? 'libraryLimit' : 'saveDataFailed'))
      return false
    }
  }
  return <LibraryContext.Provider value={{ state, ready, error, update }}>{children}</LibraryContext.Provider>
}

export function useLibrary() {
  const value = useContext(LibraryContext)
  if (!value) throw new Error('Missing library provider')
  return value
}
export function saveSource(state: Library, kind: SourceKind, id: string, add: boolean): Library {
  const key = kind === 'channel' ? 'channels' : 'playlists'
  return { ...state, [key]: add ? [...new Set([...state[key], id])] : state[key].filter(value => value !== id) }
}
export function saveFavorite(state: Library, id: string, add: boolean, context?: WatchContext): Library {
  const contexts = { ...state.contexts }
  if (add && context && Object.keys(context).length) contexts[id] = context
  if (!add) delete contexts[id]
  return { ...state, contexts, favorites: add ? [...new Set([...state.favorites, id])] : state.favorites.filter(value => value !== id) }
}
export function recordProgress(state: Library, id: string, value: Progress) {
  const progress = { ...state.progress, [id]: value }
  const ids = Object.keys(progress)
  if (ids.length > MAX_PERSONAL) {
    ids.sort((a, b) => progress[a].updatedAt - progress[b].updatedAt)
    delete progress[ids[0]]
  }
  return { ...state, progress }
}
