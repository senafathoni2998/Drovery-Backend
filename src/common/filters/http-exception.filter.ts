import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

import { captureException } from '../monitoring/sentry';
import { redactTokenInUrl } from '../redact';
import { I18nService } from '../../i18n/i18n.service';
import { parseLocale } from '../../i18n/accept-language';
import type { I18nValidationError } from '../validation/validation-exception.factory';

/**
 * Builds the error envelope AND localizes it at the boundary — the single place that holds
 * the request (so it has Accept-Language + the authed user) and the I18nService. An
 * AppException carries a `messageKey` (+ params); validation 400s carry `i18nValidationErrors`
 * (keyed per field). Both are translated with the request locale and their internal fields
 * stripped; machine `passthrough` fields (code/reasons/retryAfter/error) survive verbatim. A
 * plain HttpException (un-migrated throw) flows through unchanged (English), so the gradual
 * migration of throw sites is non-breaking. The filter stays a synchronous singleton — it
 * never DB-looks-up or awaits (translate() is total and never throws).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly i18n: I18nService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    // Redact any ?token= (the WS handshake carries the JWT in the query string).
    const url = redactTokenInUrl(request.url);
    const locale = this.resolveLocale(request);

    const body = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: url,
      ...this.renderMessage(exception, locale),
    };

    if (status >= 500) {
      this.logger.error(`${request.method} ${url}`, exception);
      // Report unexpected server errors to Sentry (no-op when disabled).
      captureException(exception, { method: request.method, path: url });
    }

    response.status(status).json(body);
  }

  /** Locale precedence: the authed user's stored locale (only if the JWT carries it) →
   * Accept-Language → I18nService default (translate() handles an unsupported/null locale). */
  private resolveLocale(request: {
    headers?: Record<string, unknown>;
    user?: { locale?: unknown };
  }): string | null {
    const userLocale = request?.user?.locale;
    if (typeof userLocale === 'string') return userLocale;
    const header = request?.headers?.['accept-language'];
    return typeof header === 'string' ? parseLocale(header) : null;
  }

  private renderMessage(
    exception: unknown,
    locale: string | null,
  ): Record<string, unknown> {
    if (!(exception instanceof HttpException)) {
      return { message: 'Internal server error' };
    }
    const raw = exception.getResponse();
    if (typeof raw === 'string') return { message: raw };
    if (!raw || typeof raw !== 'object')
      return { message: 'Internal server error' };

    const obj = { ...(raw as Record<string, unknown>) };
    delete obj.statusCode; // re-stamped from the resolved status above

    // An AppException: translate the single key, keep machine passthrough fields.
    if (typeof obj.messageKey === 'string') {
      const message = this.i18n.translate(
        obj.messageKey,
        locale,
        obj.messageParams as Record<string, string | number> | undefined,
      );
      delete obj.messageKey;
      delete obj.messageParams;
      return { message, ...obj };
    }

    // A localized validation 400: translate each keyed field error → message string[].
    if (Array.isArray(obj.i18nValidationErrors)) {
      const message = (obj.i18nValidationErrors as I18nValidationError[]).map(
        (e) => this.i18n.translate(e.key, locale, e.params),
      );
      delete obj.i18nValidationErrors;
      return { message, ...obj };
    }

    // A plain HttpException object body (un-migrated throw) — verbatim (English).
    return obj;
  }
}
