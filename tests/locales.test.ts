import { expect, test } from 'vitest'
import { languages } from '../src/lib/locale'
import en from '../src/lib/locales/en.json'

const catalogues = import.meta.glob<Record<string, string>>('../src/lib/locales/*.json', {
  eager: true, import: 'default',
})
const placeholders = (message: string) => message.match(/\{\w+\}/g)?.sort() ?? []

test('each offered language has a message catalogue', () => {
  expect(Object.keys(catalogues).sort()).toEqual(
    Object.keys(languages).map(locale => `../src/lib/locales/${locale}.json`).sort(),
  )
})

test.each(Object.entries(catalogues))('%s translates every message and preserves interpolation fields', (_, catalogue) => {
  expect(Object.keys(catalogue).sort()).toEqual(Object.keys(en).sort())
  for (const [key, message] of Object.entries(en)) {
    expect(catalogue[key].trim(), key).not.toBe('')
    expect(placeholders(catalogue[key]), key).toEqual(placeholders(message))
  }
})
