import { createRootRoute, HeadContent, Link, Scripts } from '@tanstack/react-router'
import { Providers } from '@/components/app/shell'
import css from '@/styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'referrer', content: 'strict-origin-when-cross-origin' },
      { name: 'description', content: 'mytube 是只展示你选择的视频、频道和播放列表的个人内容库。' }, { title: 'mytube · 我的内容库' },
    ],
    links: [{ rel: 'stylesheet', href: css }, { rel: 'icon', href: '/icon.svg', type: 'image/svg+xml' }],
  }),
  component: Providers,
  notFoundComponent: () => <section className="page"><h1>找不到页面</h1><Link to="/">返回首页</Link></section>,
  shellComponent: ({ children }) => <html lang="zh-CN"><head><HeadContent /></head><body>{children}<Scripts /></body></html>,
})
