import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { backgroundApi } from '@/lib/client'
import { useLibrary } from '@/lib/personal'
import { libraryJobs, syncMetadataStep } from '@/lib/metadata-sync'
import { commitMetadataStep, ensureMetadataJobs, metadataDatabase } from '@/lib/metadata-store'
import { cacheMetadata } from '@/lib/query-cache'

function delay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, milliseconds)
    signal.addEventListener('abort', abort, { once: true })
  })
}

export function LibrarySync() {
  const { state, ready } = useLibrary()
  const client = useQueryClient()
  const selection = JSON.stringify(libraryJobs(state))
  const [wake, setWake] = useState(0)
  useEffect(() => {
    const resume = () => setWake(value => value + 1)
    window.addEventListener('online', resume)
    window.addEventListener('mytube-metadata-refresh', resume)
    return () => {
      window.removeEventListener('online', resume)
      window.removeEventListener('mytube-metadata-refresh', resume)
    }
  }, [])
  useEffect(() => {
    if (!ready) return
    const controller = new AbortController()
    const signal = controller.signal
    const entries = JSON.parse(selection) as ReturnType<typeof libraryJobs>
    const channel = 'BroadcastChannel' in window ? new BroadcastChannel('mytube-metadata') : undefined
    const changed = () => {
      for (const key of ['feed', 'playlist', 'channel-lists', 'queue']) void client.invalidateQueries({ queryKey: [key] })
    }
    if (channel) channel.onmessage = changed
    const owner = crypto.randomUUID()
    const loop = async () => {
      const db = await metadataDatabase()
      await ensureMetadataJobs(entries)
      while (!signal.aborted && entries.length) {
        if (!navigator.onLine) { await delay(30_000, signal); continue }
        const cooldown = await db.get('leases', 'cooldown')
        if (cooldown && cooldown.until > Date.now()) { await delay(Math.min(30_000, cooldown.until - Date.now()), signal); continue }
        // Web Locks releases automatically on reload or tab close.
        if (!navigator.locks) {
          const tx = db.transaction('leases', 'readwrite')
          const lease = await tx.store.get('sync')
          if (lease && lease.owner !== owner && lease.until > Date.now()) {
            await tx.done
            await delay(5000, signal)
            continue
          }
          await tx.store.put({ owner, until: Date.now() + 30_000 }, 'sync')
          await tx.done
        }
        const job = await db.getFromIndex('jobs', 'nextAttempt', IDBKeyRange.upperBound(Date.now()))
        if (!job) {
          const next = await db.getFromIndex('jobs', 'nextAttempt', IDBKeyRange.lowerBound(0))
          await delay(Math.max(1200, Math.min(30_000, (next?.nextAttempt ?? Date.now() + 30_000) - Date.now())), signal)
          continue
        }
        const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(20_000)])
        try {
          await syncMetadataStep(job, backgroundApi, async (next, data) => {
            signal.throwIfAborted()
            await commitMetadataStep(next, data, job)
            // Only source headers enter the hot cache; thousands of videos stay on disk.
            if (data.source && next.activeEpoch) cacheMetadata(client, data.source, Date.now(), true)
            if (data.page || next.activeEpoch) {
              changed()
              channel?.postMessage('updated')
            }
          }, requestSignal)
        } catch (error) {
          if (signal.aborted) throw error
          // A request timeout leaves the last committed cursor ready to resume.
          await commitMetadataStep({ ...job, nextAttempt: Date.now() + 30_000, failures: job.failures + 1 }, {}, job)
        }
        // Stay under the API request budget and leave capacity for foreground actions.
        await delay(1200, signal)
      }
    }
    const start = async () => {
      await delay(1500, signal)
      if (!navigator.locks) { await loop(); return }
      while (!signal.aborted) {
        const acquired = await navigator.locks.request('mytube-library-sync', { ifAvailable: true }, async lock => {
          signal.throwIfAborted()
          if (!lock) return false
          await loop()
          return true
        })
        if (acquired) return
        await delay(5000, signal)
      }
    }
    let retry: ReturnType<typeof setTimeout> | undefined
    void start().catch(() => {
      if (!signal.aborted) retry = setTimeout(() => setWake(value => value + 1), 30_000)
    })
    return () => {
      clearTimeout(retry)
      controller.abort()
      channel?.close()
      if (!navigator.locks) void metadataDatabase().then(async db => {
        const tx = db.transaction('leases', 'readwrite')
        if ((await tx.store.get('sync'))?.owner === owner) await tx.store.delete('sync')
        await tx.done
      }).catch(() => {})
    }
  }, [client, ready, selection, wake])
  return null
}
