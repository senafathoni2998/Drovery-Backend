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

  it('composes the localized reset email (en) with From, subject, CTA, deep link + token', async () => {
    const log = jest
      .spyOn((mail as unknown as { logger: { log: jest.Mock } }).logger, 'log')
      .mockImplementation(() => undefined);
    await mail.sendPasswordResetEmail('u@x.com', 'TOK123', 'en');
    const out = log.mock.calls[0][0] as string;
    expect(out).toContain('From: no-reply@drovery.com');
    expect(out).toContain('Reset your Drovery password'); // subject
    expect(out).toContain('Reset password'); // cta label
    expect(out).toContain('droverymobile://reset-password?token=TOK123');
    expect(out).toContain('Or enter this code in the app: TOK123'); // code hint
  });

  it('localizes the verification email to Indonesian', async () => {
    const log = jest
      .spyOn((mail as unknown as { logger: { log: jest.Mock } }).logger, 'log')
      .mockImplementation(() => undefined);
    await mail.sendVerificationEmail('u@x.com', 'TOK', 'id');
    const out = log.mock.calls[0][0] as string;
    expect(out).toContain('Verifikasi email Drovery Anda'); // id subject
    expect(out).toContain('Verifikasi email'); // id cta
    expect(out).toContain('Atau masukkan kode ini di aplikasi: TOK'); // id code hint
  });
});
