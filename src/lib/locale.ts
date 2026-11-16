export const languages = {
  ar: 'العربية',
  bg: 'Български',
  bn: 'বাংলা',
  cs: 'Čeština',
  da: 'Dansk',
  de: 'Deutsch',
  el: 'Ελληνικά',
  en: 'English',
  es: 'Español',
  fa: 'فارسی',
  fi: 'Suomi',
  fil: 'Filipino',
  fr: 'Français',
  gu: 'ગુજરાતી',
  he: 'עברית',
  hi: 'हिन्दी',
  hr: 'Hrvatski',
  hu: 'Magyar',
  id: 'Bahasa Indonesia',
  it: 'Italiano',
  ja: '日本語',
  ko: '한국어',
  mr: 'मराठी',
  ms: 'Bahasa Melayu',
  nb: 'Norsk bokmål',
  nl: 'Nederlands',
  pa: 'ਪੰਜਾਬੀ',
  pl: 'Polski',
  'pt-BR': 'Português (Brasil)',
  'pt-PT': 'Português (Portugal)',
  ro: 'Română',
  ru: 'Русский',
  sk: 'Slovenčina',
  sr: 'Српски',
  sv: 'Svenska',
  sw: 'Kiswahili',
  ta: 'தமிழ்',
  te: 'తెలుగు',
  th: 'ไทย',
  tr: 'Türkçe',
  uk: 'Українська',
  ur: 'اردو',
  vi: 'Tiếng Việt',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
} as const

export type Locale = keyof typeof languages
export type LanguagePreference = Locale | 'browser'
export const languageStorageKey = 'mytube-language'
export const localeDirection = (locale: Locale) => ['ar', 'fa', 'he', 'ur'].includes(locale) ? 'rtl' as const : 'ltr' as const

export function requestLocale(cookie: string | null, acceptLanguage: string | null) {
  const saved = cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${languageStorageKey}=`))?.slice(languageStorageKey.length + 1)
  const preference: LanguagePreference = isLocale(saved) ? saved : 'browser'
  const tags = (acceptLanguage ?? '').split(',').map((part, index) => {
    const [tag, ...parameters] = part.trim().split(';')
    const quality = parameters.find(value => value.trim().startsWith('q='))?.trim().slice(2)
    return { tag, index, quality: quality === undefined ? 1 : Number(quality) }
  }).filter(value => value.quality > 0 && value.quality <= 1)
    .sort((a, b) => b.quality - a.quality || a.index - b.index).map(value => value.tag)
  return { preference, locale: preference === 'browser' ? browserLocale(tags) : preference }
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && Object.hasOwn(languages, value)
}

export function browserLocale(preferences: readonly string[]): Locale {
  for (const tag of preferences) {
    let locale: Intl.Locale
    try { locale = new Intl.Locale(tag) } catch { continue }
    const { language } = locale
    if (language === 'zh') return locale.maximize().script === 'Hant' ? 'zh-TW' : 'zh-CN'
    if (language === 'pt') return locale.maximize().region === 'BR' ? 'pt-BR' : 'pt-PT'
    if (language === 'no' || language === 'nn') return 'nb'
    if (language === 'tl') return 'fil'
    if (isLocale(language)) return language
  }
  return 'en'
}
