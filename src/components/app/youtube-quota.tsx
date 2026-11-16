import { useQuery } from '@tanstack/react-query'
import { ExternalLink, RefreshCw, TriangleAlert } from 'lucide-react'
import { Loading, Notice } from '@/components/app/common'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { api } from '@/lib/client'
import type { ApiQuota } from '@/lib/data'
import { useLocale } from '@/lib/i18n'

export function YouTubeQuota() {
  const { t, locale, apiError } = useLocale()
  const query = useQuery({
    queryKey: ['youtube-quota'],
    queryFn: ({ signal }) => api<ApiQuota>('quota', {}, signal),
    refetchInterval: 60_000,
    refetchOnMount: 'always',
    retry: false,
  })
  const quota = query.data
  const warning = quota && (!quota.configured ? 'configuration' : quota.blocked ? 'quota' : quota.remaining === 0 ? 'budget' : undefined)

  return <section className="settings-section" aria-labelledby="youtube-quota-heading">
    <div className="settings-row">
      <h2 id="youtube-quota-heading">{t('youtubeQuota')}</h2>
      <Button size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
        <RefreshCw data-icon="inline-start" />{t('quotaRefresh')}
      </Button>
    </div>
    {query.isPending && <Loading />}
    {query.error && <Notice error={query.error} retry={() => void query.refetch()} />}
    {quota && <>
      {quota.configured && <>
        <div className="settings-row">
          <span>{t('quotaUsage', { used: quota.used, limit: quota.limit })}</span>
          <span className="muted">{t('quotaRemaining', { count: quota.remaining })}</span>
        </div>
        <Progress value={Math.min(quota.used, quota.limit)} max={quota.limit} aria-label={t('youtubeQuota')} />
      </>}
      {warning && <Alert><TriangleAlert /><AlertDescription>{apiError(warning)}</AlertDescription></Alert>}
      <p className="muted"><time dateTime={new Date(quota.resetsAt).toISOString()}>{t('quotaReset', {
        date: new Date(quota.resetsAt).toLocaleString(locale, {
          year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
        }),
      })}</time></p>
    </>}
    <p className="muted">{t('quotaScope')}</p>
    <p className="muted">{t('quotaBudgetHelp')}</p>
    <a className="inline-flex items-center gap-1 justify-self-start" href="https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas" target="_blank" rel="noreferrer">
      {t('quotaConsole')}<ExternalLink className="size-3.5" aria-hidden="true" />
    </a>
  </section>
}
