import type en from './locales/en.json'

export type MessageKey = keyof typeof en

export class MessageError extends Error {
  constructor(public readonly messageKey: MessageKey, message?: string) {
    super(message)
  }
}
