import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Email gateway. Today it logs the message (so password reset works end-to-end
 * in development); swap the body of `send()` for a real provider (SendGrid /
 * SES / SMTP) — the rest of the app calls these typed methods and is unaffected.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  async sendPasswordResetEmail(to: string, token: string): Promise<void> {
    // Deep link the mobile app handles (scheme "droverymobile"), plus the raw
    // token so the user can paste it manually if the link can't open.
    const deepLink = `droverymobile://reset-password?token=${token}`;
    await this.send(
      to,
      'Reset your Drovery password',
      `Tap to reset your password: ${deepLink}\n\nOr enter this code in the app: ${token}\n\nThis link expires in 1 hour. If you didn't request it, ignore this email.`,
    );
  }

  private async send(to: string, subject: string, body: string): Promise<void> {
    const provider = this.config.get<string>('mail.provider');

    if (!provider) {
      // No provider configured (dev): log so the flow is testable locally.
      this.logger.log(
        `[MAIL:dev] To: ${to} | Subject: ${subject}\n${body}`,
      );
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
