import { describe, expect, it } from 'vitest'
import { parseYouTube, watchSearch, playlistSelection } from '../src/lib/youtube-url'
import { emptyLibrary, mergeLibrary, parseBackup } from '../src/lib/library'

describe('YouTube input', () => {
  it.each([
    'https://youtu.be/dQw4w9WgXcQ?t=1m30s&si=x',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=90s',
    'https://youtube.com/shorts/dQw4w9WgXcQ?start=90',
    'https://youtube.com/live/dQw4w9WgXcQ?t=90',
  ])('normalizes %s', (url) => {
    expect(parseYouTube(url)).toEqual({ kind: 'video', id: 'dQw4w9WgXcQ', time: 90 })
  })
  it.each(['https://youtube.com.bad.test/watch?v=dQw4w9WgXcQ', 'https://youtube.com@evil.test/', 'javascript:alert(1)', 'https://youtube.com/watch?v=bad', 'https://youtube.com/c/example'])('rejects %s', url => {
    expect(() => parseYouTube(url)).toThrow()
  })
  it('preserves Unicode handles and a one-based playlist context', () => {
    expect(parseYouTube('youtube.com/@科技频道/videos')).toEqual({ kind: 'channel', handle: '@科技频道' })
    expect(watchSearch({ v: 'dQw4w9WgXcQ', list: 'PLabcdefgh', index: 3, t: '90s', si: 'x' }))
      .toEqual({ v: 'dQw4w9WgXcQ', list: 'PLabcdefgh', index: 3, t: '90s' })
  })
  it('recovers an obsolete position using the requested video, preserving duplicates', () => {
    const rows = [{ videoId: 'first', position: 0 }, { videoId: 'same', position: 2 }, { videoId: 'same', position: 4 }]
    expect(playlistSelection(rows, 'same', 5)?.position).toBe(4)
    expect(playlistSelection(rows, 'same', 1)?.position).toBe(2)
    expect(playlistSelection(rows, 'missing', 1)).toBeUndefined()
  })
})

describe('mytube backup', () => {
  it('deduplicates ids and preserves the latest recorded progress', () => {
    const local = emptyLibrary()
    local.progress.dQw4w9WgXcQ = { at: 20, updatedAt: 200, duration: 200 }
    const imported = parseBackup(JSON.stringify({
      ...emptyLibrary(), favorites: ['dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
      progress: { dQw4w9WgXcQ: { at: 10, updatedAt: 100, duration: 200 } },
    }))
    expect(mergeLibrary(local, imported).favorites).toEqual(['dQw4w9WgXcQ'])
    expect(mergeLibrary(local, imported).progress.dQw4w9WgXcQ.at).toBe(20)
  })
  it.each(['{"schemaVersion":2}', '{"schemaVersion":1,"favorites":["<script>"]}', 'x'.repeat(550_000)])('rejects an invalid backup case %#', raw => {
    expect(() => parseBackup(raw)).toThrow()
  })
})
