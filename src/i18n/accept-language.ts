import { DEFAULT_LOCALE, Locale, SUPPORTED_LOCALES } from './catalog';

/**
 * Best-effort locale from an `Accept-Language` header. Takes the first tag, drops
 * its `;q=` weight, lower-cases it, strips the region subtag (`id-ID` → `id`), and
 * returns it iff supported (else the default). No npm dependency: a first-tag
 * q-suffix (`id;q=1.0`) is tolerated, but RELATIVE q-ranking across tags is
 * intentionally ignored (overkill for two locales). Used only where there's no
 * persisted User.locale (the anonymous password-reset email; the signup default).
 */
export function parseLocale(header?: string | null): Locale {
  const tag = header
    ?.split(',')[0] // first tag of the list
    ?.split(';')[0] // drop the ;q= weight
    ?.trim()
    .toLowerCase()
    .split('-')[0]; // strip the region subtag
  return (SUPPORTED_LOCALES as string[]).includes(tag ?? '')
    ? (tag as Locale)
    : DEFAULT_LOCALE;
}
