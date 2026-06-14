import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Locale } from '../i18n/catalog';
import { I18nService } from '../i18n/i18n.service';

/**
 * Email gateway. Today it logs the message (so password reset works end-to-end
 * in development); swap the body of `send()` for a real provider (SendGrid /
 * SES / SMTP) — the rest of the app calls these typed methods and is unaffected.
 * Subjects/bodies are localized via the catalog; the locale is the recipient's
 * (passed by the caller — Accept-Language for the anonymous reset, the user's
 * stored locale otherwise).
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
    // Deep link the mobile app handles (scheme "droverymobile"), plus the raw
    // token so the user can paste it manually if the link can't open.
    const deepLink = `droverymobile://reset-password?token=${token}`;
    await this.send(
      to,
      this.i18n.translate('email.passwordReset.subject', locale),
      this.i18n.translate('email.passwordReset.body', locale, {
        deepLink,
        token,
      }),
    );
  }

  async sendVerificationEmail(
    to: string,
    token: string,
    locale: Locale = 'en',
  ): Promise<void> {
    const deepLink = `droverymobile://verify-email?token=${token}`;
    await this.send(
      to,
      this.i18n.translate('email.verification.subject', locale),
      this.i18n.translate('email.verification.body', locale, {
        deepLink,
        token,
      }),
    );
  }

  // async by seam contract (the real SendGrid/SES provider awaits a network call);
  // the dev-stub path only logs, hence no await yet.
  // eslint-disable-next-line @typescript-eslint/require-await
  private async send(to: string, subject: string, body: string): Promise<void> {
    const provider = this.config.get<string>('mail.provider');

    if (!provider) {
      // No provider configured (dev): log so the flow is testable locally.
      this.logger.log(`[MAIL:dev] To: ${to} | Subject: ${subject}\n${body}`);
      return;
    }

    // TODO: integrate the configured provider here, e.g.:
    //   await this.sendgrid.send({ to, from, subject, text: body });
    this.logger.warn(
      `Mail provider "${provider}" is configured but not implemented; logging instead.`,
    );
    this.logger.log(`[MAIL] To: ${to} | Subject: ${subject}\n${body}`);
  }
}
