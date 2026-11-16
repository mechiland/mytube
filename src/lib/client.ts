import { queryOptions } from '@tanstack/react-query'
import type { Source, SourceKind, SyncStatus, Video } from './data'
import { readLocalMetadata, recordMetadata, refreshLocalSource } from './metadata-store'

export class RequestError extends Error {
  constructor(public code: string, message: string) { super(message) }
}
async function requestApi<T>(path: string, params: Record<string, string | number | undefined> = {}, signal?: AbortSignal, data?: unknown, background = false): Promise<T> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value))
  const response = await fetch(`/api/${path}?${query}`, {
    signal, headers: { ...(background ? { 'X-Mytube-Background': '1' } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) }),
  }).catch((e: unknown) => {
    if (signal?.aborted) throw e
    throw new RequestError('network', '无法连接服务，请重试。')
  })
  const value = await response.json()
  if (!response.ok) {
    const problem = value as { error?: string; message?: string }
    throw new RequestError(problem.error ?? 'service', problem.message ?? '请求失败，请重试。')
  }
  return value as T
}
export const backgroundApi = <T>(path: string, params: Record<string, string | number | undefined> = {}, signal?: AbortSignal, data?: unknown) =>
  requestApi<T>(path, params, signal, data, true)

export async function api<T>(path: string, params: Record<string, string | number | undefined> = {}, signal?: AbortSignal, data?: unknown): Promise<T> {
  signal?.throwIfAborted()
  if (typeof window !== 'undefined') {
    const local = await readLocalMetadata(path, params, data).catch(() => undefined)
    signal?.throwIfAborted()
    if (local !== undefined) return local as T
  }
  if (String(params.cursor ?? '').startsWith('local:')) throw new RequestError('page', '本地分页已更新，请刷新重试。')
  const value = await requestApi<T>(path, params, signal, data)
  if (typeof window !== 'undefined') {
    await recordMetadata(value).catch(() => {})
    if (path === 'refresh') {
      await refreshLocalSource(value as SyncStatus).catch(() => {})
      window.dispatchEvent(new Event('mytube-metadata-refresh'))
    }
  }
  return value
}
export type SourceResponse = { data: Source; status?: SyncStatus }
export const sourceQuery = (kind: SourceKind, id?: string, handle?: string, start = true) => queryOptions({
  queryKey: ['source', kind, id, handle, start],
  queryFn: ({ signal }) => api<SourceResponse>('source', { kind, id, handle, start: start ? '1' : undefined }, signal),
  enabled: !!(id || handle),
  staleTime: 120_000,
})
export const videoQuery = (id?: string) => queryOptions({
  queryKey: ['video', id], queryFn: ({ signal }) => api<Video>('video', { id }, signal), enabled: !!id, staleTime: 600_000,
})
export const formatDuration = (seconds: number) => {
  const n = Math.floor(seconds)
  return n >= 3600
    ? [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60].map((v, i) => i ? String(v).padStart(2, '0') : v).join(':')
    : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`
}
export const formatDate = (value: string | number, locale: string) => {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? '' : date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
}
export function safeImage(url: string | undefined) {
  try {
    const value = new URL(url ?? '')
    return value.protocol === 'https:' ? value.href : undefined
  } catch { return undefined }
}
