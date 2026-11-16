import type { Locale, LanguagePreference } from './locale'
import type { MessageKey } from './message-error'
import en from './locales/en.json'

export type Messages = Record<MessageKey, string>
export type Catalogue = { locale: Locale; messages: Messages }
export type InitialLocale = Catalogue & { preference: LanguagePreference }
export const english: Catalogue = { locale: 'en', messages: en }
const catalogues = import.meta.glob<Messages>(['./locales/*.json', '!./locales/en.json'], { import: 'default' })

export async function loadCatalogue(locale: Locale): Promise<Catalogue> {
  const load = catalogues[`./locales/${locale}.json`]
  return load ? { locale, messages: await load() } : english
}
