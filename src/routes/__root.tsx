import { ClientOnly, createRootRoute, HeadContent, Link, Scripts } from '@tanstack/react-router'
import { Providers, ShellPlaceholder } from '@/components/app/shell'
import { LocaleProvider, useLocale } from '@/lib/i18n'
import en from '@/lib/locales/en.json'
import css from '@/styles.css?url'

function NotFound() {
  const { t } = useLocale()
  return <section className="page"><h1>{t('pageNotFound')}</h1><Link to="/">{t('backHome')}</Link></section>
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'referrer', content: 'strict-origin-when-cross-origin' },
      { name: 'description', content: en.appDescription }, { title: en.appTitle },
    ],
    links: [{ rel: 'stylesheet', href: css }, { rel: 'icon', href: '/icon.svg', type: 'image/svg+xml' }],
  }),
  component: Providers,
  notFoundComponent: NotFound,
  shellComponent: ({ children }) => {
    const fallback = <ShellPlaceholder />
    return <html lang="en" dir="ltr"><head><HeadContent /></head><body>
      <ClientOnly fallback={fallback}><LocaleProvider fallback={fallback}>{children}</LocaleProvider></ClientOnly>
      <Scripts />
    </body></html>
  },
})
