import { createRootRoute, HeadContent, Link, Scripts } from '@tanstack/react-router'
import { Providers } from '@/components/app/shell'
import { LocaleProvider, useLocale } from '@/lib/i18n'
import { loadBootstrap } from '@/lib/bootstrap'
import { localeDirection } from '@/lib/locale'
import en from '@/lib/locales/en.json'
import css from '@/styles.css?url'

function NotFound() {
  const { t } = useLocale()
  return <section className="page"><h1>{t('pageNotFound')}</h1><Link to="/">{t('backHome')}</Link></section>
}

export const Route = createRootRoute({
  loader: () => loadBootstrap(),
  head: ({ loaderData }) => ({
    meta: [
      { charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'referrer', content: 'strict-origin-when-cross-origin' },
      { name: 'description', content: loaderData?.language.messages.appDescription ?? en.appDescription },
      { title: loaderData?.language.messages.appTitle ?? en.appTitle },
    ],
    links: [{ rel: 'stylesheet', href: css }, { rel: 'icon', href: '/icon.svg', type: 'image/svg+xml' },
      { rel: 'preconnect', href: 'https://i.ytimg.com' }, { rel: 'preconnect', href: 'https://yt3.ggpht.com' }],
  }),
  component: function Root() {
    const data = Route.useLoaderData()
    return <Providers initialQueries={data?.queries} />
  },
  notFoundComponent: NotFound,
  shellComponent: ({ children }) => {
    const data = Route.useLoaderData()
    return <html lang={data?.language.locale ?? 'en'} dir={localeDirection(data?.language.locale ?? 'en')}><head><HeadContent /></head><body>
      <LocaleProvider initial={data?.language}>{children}</LocaleProvider>
      <Scripts />
    </body></html>
  },
})
