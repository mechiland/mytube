import { DirectionProvider } from '@base-ui/react/direction-provider'
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { RequestError } from './client'
import { browserLocale, isLocale, languageStorageKey, localeDirection, type LanguagePreference } from './locale'
import { english, loadCatalogue, type Catalogue, type InitialLocale } from './catalogue'
import { MessageError, type MessageKey } from './message-error'
import en from './locales/en.json'

type Values = Record<string, string | number>
const storageKey = languageStorageKey

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

function savedPreference(fallback: LanguagePreference = 'browser'): LanguagePreference {
  try {
    const value = window.localStorage.getItem(storageKey)
    if (isLocale(value)) return value
  } catch { /* Storage can be disabled. */ }
  return fallback
}

function saveLanguageCookie(value: LanguagePreference) {
  document.cookie = `${storageKey}=${value === 'browser' ? '' : value}; Path=/; Max-Age=${value === 'browser' ? 0 : 31536000}; SameSite=Lax`
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
    dir: localeDirection(locale),
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

export function LocaleProvider({ children, initial }: { children: ReactNode; initial?: InitialLocale }) {
  const [preference, setLanguage] = useState<LanguagePreference>(initial?.preference ?? 'browser')
  const [browser, setBrowser] = useState(initial?.locale ?? 'en')
  const requested = preference === 'browser' ? browser : preference
  const [catalogue, setCatalogue] = useState<Catalogue>(initial ?? english)
  const translation = useMemo(() => translate(catalogue), [catalogue])

  useEffect(() => {
    const saved = savedPreference(initial?.preference)
    setLanguage(saved)
    setBrowser(currentBrowserLocale())
    saveLanguageCookie(saved)
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
    if (requested === catalogue.locale) return
    let current = true
    void loadCatalogue(requested).then(value => {
      if (current) setCatalogue(value)
    }).catch(() => {
      if (current) setCatalogue(english)
    })
    return () => { current = false }
  }, [requested, catalogue.locale])

  useLayoutEffect(() => {
    const { locale, dir, t } = translation
    document.documentElement.lang = locale
    document.documentElement.dir = dir
    document.title = t('appTitle')
    document.querySelector('meta[name="description"]')?.setAttribute('content', t('appDescription'))
  }, [catalogue, translation])

  function setPreference(value: LanguagePreference) {
    setLanguage(value)
    saveLanguageCookie(value)
    try {
      if (value === 'browser') window.localStorage.removeItem(storageKey)
      else window.localStorage.setItem(storageKey, value)
    } catch { /* The selected language still applies in this tab. */ }
  }

  return <LocaleContext.Provider value={{ ...translation, preference, setPreference }}>
    <DirectionProvider direction={translation.dir}>{children}</DirectionProvider>
  </LocaleContext.Provider>
}

export function useLocale() {
  return useContext(LocaleContext)
}
