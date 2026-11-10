import { useInfiniteQuery } from '@tanstack/react-query'
import { ChevronDown, ThumbsUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { api, formatDate, RequestError } from '@/lib/client'
import type { Comment, Page } from '@/lib/data'
import { useLocale } from '@/lib/i18n'
import { ChannelLink, Loading, Notice } from './common'
import { LoadMore } from './browse'

type Order = 'relevance' | 'time'
function CommentPages({ video, order, parent, revision = 0 }: { video: string; order: Order; parent?: string; revision?: number }) {
  const { t, errorText } = useLocale()
  const query = useInfiniteQuery({
    queryKey: ['comments', video, parent ? 'replies' : order, parent ?? revision], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => api<Page<Comment>>('comments', { id: video, order, parent, cursor: pageParam }, signal),
    getNextPageParam: p => p.next, staleTime: 0,
  })
  if (query.isPending) return <Loading label={parent ? t('loadingReplies') : t('loadingComments')} />
  const code = query.error instanceof RequestError ? query.error.code : ''
  if (query.error && !query.data) {
    return ['commentsDisabled', 'commentsUnavailable'].includes(code) ? <p className="muted" role="status">{errorText(query.error)}</p>
      : <Notice title={parent ? t('repliesFailed') : t('commentsFailed')} error={query.error} retry={() => void query.refetch()} />
  }
  const comments = query.data?.pages.flatMap(p => p.items) ?? []
  if (!comments.length) return <p className="muted">{parent ? t('noReplies') : t('noComments')}</p>
  return <>
    <ol className="comment-list">{[...new Map(comments.map(c => [c.id, c])).values()].map(comment =>
      <CommentRow key={comment.id} comment={comment} video={video} />)}</ol>
    {query.error && <Notice error={query.error} retry={() => void query.fetchNextPage()} />}
    <LoadMore more={query.hasNextPage} loading={query.isFetchingNextPage} next={() => void query.fetchNextPage()} />
  </>
}
function CommentRow({ comment, video }: { comment: Comment; video: string }) {
  const { t, locale, number } = useLocale()
  const [full, setFull] = useState(false)
  const [replies, setReplies] = useState(false)
  const long = comment.text.length > 320 || comment.text.split('\n').length > 5
  const body = long && !full ? comment.text.split('\n').slice(0, 5).join('\n').slice(0, 320) + '…' : comment.text
  return <li className="comment-row">
    <div className="comment-byline">
      {comment.channelId ? <ChannelLink id={comment.channelId}>{comment.author}</ChannelLink> : <strong>{comment.author}</strong>}
      <time className="muted" dateTime={comment.published}>{formatDate(comment.published, locale)}</time>
    </div>
    <p className="comment-text" dir="auto">{body}</p>
    {long && <Button size="sm" variant="ghost" aria-expanded={full} onClick={() => setFull(v => !v)}>{full ? t('showLess') : t('showFullComment')}</Button>}
    <div className="comment-likes"><ThumbsUp aria-hidden="true" /><span aria-label={t('likes', { count: comment.likes })}>{number(comment.likes)}</span></div>
    {comment.replies > 0 && <Button variant="soft" size="sm" aria-expanded={replies} onClick={() => setReplies(v => !v)}>
      <ChevronDown data-icon="inline-start" />{replies ? t('hideReplies') : t('showReplies', { count: comment.replies })}
    </Button>}
    {replies && <div className="replies"><CommentPages video={video} order="time" parent={comment.id} /></div>}
  </li>
}
export function Comments({ video }: { video: string }) {
  const { t } = useLocale()
  const anchor = useRef<HTMLElement>(null)
  const [enabled, setEnabled] = useState(false)
  const [{ order, revision }, setSort] = useState<{ order: Order; revision: number }>({ order: 'relevance', revision: 0 })
  useEffect(() => {
    if (!anchor.current || enabled || !('IntersectionObserver' in window)) return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setEnabled(true); observer.disconnect() }
    }, { rootMargin: '120px' })
    observer.observe(anchor.current)
    return () => observer.disconnect()
  }, [enabled])
  return <section className="comments" ref={anchor} aria-labelledby="comments-heading">
    <div className="comments-heading"><h2 id="comments-heading">{t('publicComments')}</h2>
      <NativeSelect aria-label={t('commentSort')} value={order} onChange={e => {
        const next = e.target.value === 'time' ? 'time' : 'relevance'
        setSort(previous => ({ order: next, revision: previous.revision + 1 }))
        setEnabled(true)
      }}>
        <NativeSelectOption value="relevance">{t('topComments')}</NativeSelectOption>
        <NativeSelectOption value="time">{t('newestComments')}</NativeSelectOption>
      </NativeSelect>
    </div>
    {enabled ? <CommentPages key={revision} video={video} order={order} revision={revision} /> : <Button variant="outline" onClick={() => setEnabled(true)}>{t('loadComments')}</Button>}
  </section>
}
