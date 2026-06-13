import { en } from './en';
import { id } from './id';

/** Supported BCP-47 base languages. English is the default + fallback. */
export type Locale = 'en' | 'id';

export const DEFAULT_LOCALE: Locale = 'en';
export const SUPPORTED_LOCALES: Locale[] = ['en', 'id'];

export type MessageCatalog = Record<string, string>;

/** Per-locale flat message catalogs (dot-namespaced keys). `en` is authoritative
 * — every key MUST exist in `en`; other locales fall back to it per key. */
export const CATALOGS: Record<Locale, MessageCatalog> = { en, id };

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as string[]).includes(value);
}
