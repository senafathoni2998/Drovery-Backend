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
    expect(
      i18n.translate('notification.stage.CONFIRMED.title', undefined),
    ).toBe('Delivery Confirmed');
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
    const out = i18n.translate('error.delivery.cancel.bad_status', 'en', {
      status: 'IN_TRANSIT',
      allowed: 'SCHEDULED, PENDING',
    });
    expect(out).toContain('IN_TRANSIT');
    expect(out).toContain('SCHEDULED, PENDING');
    expect(out).not.toContain('{status}');
    expect(out).not.toContain('{allowed}');
  });

  it('leaves an unknown {param} literal rather than rendering "undefined"', () => {
    const out = i18n.translate('error.delivery.cancel.bad_status', 'en', {
      status: 'IN_TRANSIT',
      // `allowed` intentionally omitted
    });
    expect(out).toContain('{allowed}');
    expect(out).not.toContain('undefined');
  });

  it('is a no-op interpolation when no params are given', () => {
    const out = i18n.translate('error.delivery.cancel.bad_status', 'en');
    expect(out).toContain('{status}'); // left literal, not crashed
  });
});
