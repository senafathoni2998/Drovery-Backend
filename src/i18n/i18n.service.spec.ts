import { I18nService } from './i18n.service';

describe('I18nService', () => {
  const i18n = new I18nService();

  it('returns the requested-locale string', () => {
    expect(i18n.translate('notification.stage.CONFIRMED.title', 'en')).toBe(
      'Delivery Confirmed',
    );
    expect(i18n.translate('notification.stage.CONFIRMED.title', 'id')).toBe(
      'Pengiriman Dikonfirmasi',
    );
  });

  it('falls back to English for an unsupported locale', () => {
    expect(i18n.translate('notification.stage.CONFIRMED.title', 'fr')).toBe(
      'Delivery Confirmed',
    );
  });

  it('falls back to English for a null/undefined locale', () => {
    expect(i18n.translate('notification.stage.CONFIRMED.title', null)).toBe(
      'Delivery Confirmed',
    );
    expect(i18n.translate('notification.stage.CONFIRMED.title', undefined)).toBe(
      'Delivery Confirmed',
    );
  });

  it('returns the key itself for a genuinely unknown key (never throws/empty)', () => {
    expect(i18n.translate('nope.does.not.exist', 'en')).toBe(
      'nope.does.not.exist',
    );
    expect(i18n.translate('nope.does.not.exist', 'id')).toBe(
      'nope.does.not.exist',
    );
  });

  it('interpolates {placeholder} params', () => {
    const out = i18n.translate('email.passwordReset.body', 'en', {
      deepLink: 'droverymobile://reset?token=abc',
      token: 'abc',
    });
    expect(out).toContain('droverymobile://reset?token=abc');
    expect(out).toContain('abc');
    expect(out).not.toContain('{deepLink}');
    expect(out).not.toContain('{token}');
  });

  it('leaves an unknown {param} literal rather than rendering "undefined"', () => {
    const out = i18n.translate('email.passwordReset.body', 'en', {
      deepLink: 'x',
      // token intentionally omitted
    });
    expect(out).toContain('{token}');
    expect(out).not.toContain('undefined');
  });

  it('is a no-op interpolation when no params are given', () => {
    const out = i18n.translate('email.passwordReset.body', 'en');
    expect(out).toContain('{deepLink}'); // left literal, not crashed
  });
});
