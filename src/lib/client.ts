import { queryOptions } from '@tanstack/react-query'
import type { Source, SourceKind, SyncStatus, Video } from './data'

export class RequestError extends Error {
  constructor(public code: string, message: string) { super(message) }
}
export async function api<T>(path: string, params: Record<string, string | number | undefined> = {}, signal?: AbortSignal, data?: unknown): Promise<T> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value))
  const response = await fetch(`/api/${path}?${query}`, {
    signal, ...(data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
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
export const formatDate = (value: string | number) => {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? '' : date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
}
export function safeImage(url: string | undefined) {
  try {
    const value = new URL(url ?? '')
    return value.protocol === 'https:' ? value.href : undefined
  } catch { return undefined }
}
