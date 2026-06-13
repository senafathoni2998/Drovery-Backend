import { Injectable } from '@nestjs/common';

import {
  CATALOGS,
  DEFAULT_LOCALE,
  Locale,
  isSupportedLocale,
} from './catalog';

/**
 * In-house, NON-request-scoped localization. Deliberately a plain default-scope
 * singleton (NOT request-scoped, NOT nestjs-i18n): the primary surface — delivery
 * notifications — is produced by the BullMQ worker (SimulationProcessor), which
 * has NO HTTP request. Locale is a persisted `User.locale` resolved by userId, so
 * translation must be a pure function of (key, locale, params) usable identically
 * in the worker loop and request handlers. Do NOT make this request-scoped, and do
 * NOT inject a request-scoped provider into it — that would break the worker.
 *
 * translate() is TOTAL and NEVER throws: a missing key, unknown/null locale, or a
 * bad interpolation degrades gracefully (locale→default, key→en→key-string), so it
 * can never break a delivery-status notification or fail a worker job.
 */
@Injectable()
export class I18nService {
  /**
   * Resolve a message key to a localized, interpolated string.
   * Fallback chain: requested locale → English → the key itself (diagnosable,
   * never a crash or empty string). Interpolation is guarded; a missing `{param}`
   * is left literal rather than rendered as "undefined".
   */
  translate(
    key: string,
    locale?: string | null,
    params?: Record<string, string | number>,
  ): string {
    const resolved: Locale = isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
    const template =
      CATALOGS[resolved][key] ?? CATALOGS[DEFAULT_LOCALE][key] ?? key;
    return this.interpolate(template, params);
  }

  private interpolate(
    template: string,
    params?: Record<string, string | number>,
  ): string {
    if (!params) return template;
    try {
      return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in params ? String(params[name]) : match,
      );
    } catch {
      // Never let a malformed template/param break the caller.
      return template;
    }
  }
}
