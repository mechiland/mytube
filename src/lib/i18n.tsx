import { DirectionProvider } from '@base-ui/react/direction-provider'
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { RequestError } from './client'
import { browserLocale, isLocale, type LanguagePreference, type Locale } from './locale'
import { MessageError, type MessageKey } from './message-error'
import en from './locales/en.json'

type Messages = Record<MessageKey, string>
type Values = Record<string, string | number>
type Catalogue = { locale: Locale; messages: Messages }
const catalogues = import.meta.glob<Messages>(['./locales/*.json', '!./locales/en.json'], { import: 'default' })
const english: Catalogue = { locale: 'en', messages: en }
const storageKey = 'mytube-language'
const rtlLanguages = new Set<Locale>(['ar', 'fa', 'he', 'ur'])

const apiErrors: Record<string, MessageKey> = {
  input: 'errorInput',
  configuration: 'errorConfiguration',
  credentials: 'errorCredentials',
  quota: 'errorQuota',
  budget: 'errorBudget',
  storage: 'errorStorage',
  network: 'errorNetwork',
  missing: 'errorMissing',
  commentsDisabled: 'errorCommentsDisabled',
  commentsUnavailable: 'errorCommentsUnavailable',
  rate: 'errorRate',
  busy: 'errorBusy',
  page: 'errorPage',
  service: 'errorService',
}

function currentBrowserLocale() {
  return browserLocale([...(navigator.languages ?? []), navigator.language])
}

function savedPreference(): LanguagePreference {
  try {
    const value = window.localStorage.getItem(storageKey)
    if (isLocale(value)) return value
  } catch { /* Storage can be disabled. */ }
  return 'browser'
}

function translate({ locale, messages }: Catalogue) {
  const numbers = new Intl.NumberFormat(locale)
  const t = (key: MessageKey, values?: Values) => {
    const message = messages[key] ?? en[key]
    return values ? message.replace(/\{(\w+)\}/g, (match, name: string) => {
      const value = values[name]
      return typeof value === 'number' ? numbers.format(value) : value ?? match
    }) : message
  }
  const apiError = (code: string) => t(Object.hasOwn(apiErrors, code) ? apiErrors[code] : 'errorService')
  return {
    locale, t, number: (value: number) => numbers.format(value),
    dir: rtlLanguages.has(locale) ? 'rtl' as const : 'ltr' as const,
    apiError,
    errorText: (error: unknown) => {
      if (error instanceof MessageError) return t(error.messageKey)
      if (error instanceof RequestError) return apiError(error.code)
      return t('checkLink')
    },
  }
}

const LocaleContext = createContext({
  ...translate(english),
  preference: 'browser' as LanguagePreference,
  setPreference: (_value: LanguagePreference) => {},
})

export function LocaleProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [preference, setLanguage] = useState(savedPreference)
  const [browser, setBrowser] = useState(currentBrowserLocale)
  const requested = preference === 'browser' ? browser : preference
  const [catalogue, setCatalogue] = useState<Catalogue | undefined>(() => requested === 'en' ? english : undefined)
  const translation = useMemo(() => translate(catalogue ?? english), [catalogue])

  useEffect(() => {
    const updateBrowser = () => setBrowser(currentBrowserLocale())
    const updatePreference = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) setLanguage(savedPreference())
    }
    window.addEventListener('languagechange', updateBrowser)
    window.addEventListener('storage', updatePreference)
    return () => {
      window.removeEventListener('languagechange', updateBrowser)
      window.removeEventListener('storage', updatePreference)
    }
  }, [])

  useEffect(() => {
    const load = catalogues[`./locales/${requested}.json`]
    if (!load) { setCatalogue(english); return }
    let current = true
    void load().then(messages => {
      if (current) setCatalogue({ locale: requested, messages })
    }).catch(() => {
      if (current) setCatalogue(english)
    })
    return () => { current = false }
  }, [requested])

  useLayoutEffect(() => {
    if (!catalogue) return
    const { locale, dir, t } = translation
    document.documentElement.lang = locale
    document.documentElement.dir = dir
    document.title = t('appTitle')
    document.querySelector('meta[name="description"]')?.setAttribute('content', t('appDescription'))
  }, [catalogue, translation])

  function setPreference(value: LanguagePreference) {
    setLanguage(value)
    try {
      if (value === 'browser') window.localStorage.removeItem(storageKey)
      else window.localStorage.setItem(storageKey, value)
    } catch { /* The selected language still applies in this tab. */ }
  }

  if (!catalogue) return fallback
  return <LocaleContext.Provider value={{ ...translation, preference, setPreference }}>
    <DirectionProvider direction={translation.dir}>{children}</DirectionProvider>
  </LocaleContext.Provider>
}

export function useLocale() {
  return useContext(LocaleContext)
}
