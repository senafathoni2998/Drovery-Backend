import { ConfigService } from '@nestjs/config';

import { MailService } from './mail.service';
import { EmailContent, renderHtml, renderText } from './mail-renderer';
import { I18nService } from '../i18n/i18n.service';

const sample: EmailContent = {
  heading: 'Reset your password',
  body: 'Tap the button below.',
  ctaLabel: 'Reset',
  ctaUrl: 'droverymobile://reset-password?token=ABC',
  codeHint: 'Or enter this code in the app: ABC',
  signoff: '— The Drovery team',
  footer: 'Drovery',
};

describe('mail-renderer', () => {
  it('plaintext twin lays out every block + the CTA url', () => {
    const text = renderText(sample);
    expect(text).toContain('Reset your password');
    expect(text).toContain('Tap the button below.');
    expect(text).toContain('Reset: droverymobile://reset-password?token=ABC');
    expect(text).toContain('Or enter this code in the app: ABC');
    expect(text).toContain('— The Drovery team');
  });

  it('HTML twin escapes dynamic values and links the CTA button', () => {
    const html = renderHtml({
      ...sample,
      heading: 'A & B <x>',
      ctaUrl: 'u"rl',
    });
    expect(html).toContain('A &amp; B &lt;x&gt;'); // escaped heading
    expect(html).toContain('href="u&quot;rl"'); // escaped url in href
    expect(html).toContain('<a '); // a real button anchor
    expect(html).not.toContain('A & B <x>'); // no raw injection
  });
});

describe('MailService', () => {
  let mail: MailService;

  beforeEach(() => {
    // provider unset → dev-log path; from is plumbed.
    const config = {
      get: jest.fn((k: string) =>
        k === 'mail.from' ? 'no-reply@drovery.com' : undefined,
      ),
    } as unknown as ConfigService;
    mail = new MailService(config, new I18nService());
  });

  /**
   * All output goes through `logger.log`: call 0 is the always-safe metadata line,
   * call 1 (non-production only) is the rendered body. The body is deliberately NOT
   * at debug — the pino level defaults to `info` and LOG_LEVEL is set nowhere, so a
   * debug line would never actually be emitted by the running app.
   */
  const spyLog = () =>
    jest
      .spyOn((mail as unknown as { logger: { log: jest.Mock } }).logger, 'log')
      .mockImplementation(() => undefined);

  it('composes the localized reset email (en) with From, subject, CTA, deep link + token', async () => {
    const log = spyLog();
    await mail.sendPasswordResetEmail('u@x.com', 'TOK123', 'en');

    // Metadata line — safe to emit anywhere.
    const meta = log.mock.calls[0][0] as string;
    expect(meta).toContain('From: no-reply@drovery.com');
    expect(meta).toContain('Reset your Drovery password'); // subject
    expect(meta).not.toContain('TOK123'); // the token never rides the metadata line

    // Composition is still asserted — via the dev-only body line.
    const body = log.mock.calls[1][0] as string;
    expect(body).toContain('Reset password'); // cta label
    expect(body).toContain('droverymobile://reset-password?token=TOK123');
    expect(body).toContain('Or enter this code in the app: TOK123'); // code hint
  });

  it('localizes the verification email to Indonesian', async () => {
    const log = spyLog();
    await mail.sendVerificationEmail('u@x.com', 'TOK', 'id');

    expect(log.mock.calls[0][0] as string).toContain(
      'Verifikasi email Drovery Anda',
    ); // id subject
    const body = log.mock.calls[1][0] as string;
    expect(body).toContain('Verifikasi email'); // id cta
    expect(body).toContain('Atau masukkan kode ini di aplikasi: TOK'); // id code hint
  });

  it('NEVER logs the rendered body in production, on either branch', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const log = spyLog();
      await mail.sendPasswordResetEmail('u@x.com', 'TOK123', 'en');

      // Metadata only — one line, and the token is in none of them. This is the
      // DEFAULT deploy path: no mail provider is integrated, so production takes
      // the same branch development does.
      expect(log).toHaveBeenCalledTimes(1);
      for (const call of log.mock.calls) {
        expect(String(call[0])).not.toContain('TOK123');
      }
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
