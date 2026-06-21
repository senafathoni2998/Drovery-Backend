import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Locale } from '../i18n/catalog';
import { I18nService } from '../i18n/i18n.service';
import { EmailContent, renderHtml, renderText } from './mail-renderer';

/**
 * Email gateway. Today it logs the message (so password reset / verification work
 * end-to-end in development); swap the body of `send()` for a real provider
 * (SendGrid / SES / SMTP) — it already receives { to, from, subject, text, html }.
 * Copy is localized via the catalog (subject + heading + body + cta blocks, plus the
 * shared common.* chrome); MailRenderer composes the plaintext + HTML twins. The locale
 * is the recipient's (passed by the caller — Accept-Language for the anonymous reset,
 * the user's stored locale otherwise).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly i18n: I18nService,
  ) {}

  async sendPasswordResetEmail(
    to: string,
    token: string,
    locale: Locale = 'en',
  ): Promise<void> {
    // Deep link the mobile app handles (scheme "droverymobile"); the token also rides
    // in the body so the user can paste it manually if the link can't open.
    const deepLink = `droverymobile://reset-password?token=${token}`;
    await this.sendTemplate(to, 'passwordReset', deepLink, token, locale);
  }

  async sendVerificationEmail(
    to: string,
    token: string,
    locale: Locale = 'en',
  ): Promise<void> {
    const deepLink = `droverymobile://verify-email?token=${token}`;
    await this.sendTemplate(to, 'verification', deepLink, token, locale);
  }

  /** Compose one transactional email from its catalog blocks + the shared chrome. */
  private async sendTemplate(
    to: string,
    name: 'passwordReset' | 'verification',
    deepLink: string,
    token: string,
    locale: Locale,
  ): Promise<void> {
    const t = (key: string, params?: Record<string, string | number>): string =>
      this.i18n.translate(key, locale, params);
    const content: EmailContent = {
      heading: t(`email.${name}.heading`),
      body: t(`email.${name}.body`),
      ctaLabel: t(`email.${name}.cta`),
      ctaUrl: deepLink,
      codeHint: t('email.common.codeHint', { token }),
      signoff: t('email.common.signoff'),
      footer: t('email.common.footer'),
    };
    await this.send(
      to,
      t(`email.${name}.subject`),
      renderText(content),
      renderHtml(content),
    );
  }

  // async by seam contract (the real SendGrid/SES provider awaits a network call);
  // the dev-stub path only logs, hence no await yet.
  // eslint-disable-next-line @typescript-eslint/require-await
  private async send(
    to: string,
    subject: string,
    text: string,
    html: string,
  ): Promise<void> {
    const provider = this.config.get<string>('mail.provider');
    const from = this.config.get<string>('mail.from');

    if (!provider) {
      // No provider configured (dev): log so the flow is testable locally.
      this.logger.log(
        `[MAIL:dev] From: ${from} To: ${to} | Subject: ${subject} (html ${html.length}b)\n${text}`,
      );
      return;
    }

    // TODO: integrate the configured provider here, e.g.:
    //   await this.sendgrid.send({ to, from, subject, text, html });
    this.logger.warn(
      `Mail provider "${provider}" is configured but not implemented; logging instead.`,
    );
    this.logger.log(
      `[MAIL] From: ${from} To: ${to} | Subject: ${subject} (html ${html.length}b)\n${text}`,
    );
  }
}
