import { parseLocale } from './accept-language';

describe('parseLocale', () => {
  it('maps a region-tagged supported locale to its base', () => {
    expect(parseLocale('id-ID')).toBe('id');
    expect(parseLocale('en-US')).toBe('en');
  });

  it('takes the first tag of a weighted list', () => {
    expect(parseLocale('id,en;q=0.9')).toBe('id');
    expect(parseLocale('en-GB,en;q=0.8,id;q=0.5')).toBe('en');
  });

  it('tolerates a q-value on the first/only tag (RFC 7231 §5.3.5)', () => {
    expect(parseLocale('id;q=1.0')).toBe('id');
    expect(parseLocale('id;q=0.9')).toBe('id');
    expect(parseLocale('id-ID;q=1.0')).toBe('id');
    expect(parseLocale(' id ; q=1.0')).toBe('id');
    expect(parseLocale('en;q=1.0')).toBe('en');
  });

  it('falls back to the default for an unsupported or empty header', () => {
    expect(parseLocale('fr')).toBe('en');
    expect(parseLocale('zh-CN')).toBe('en');
    expect(parseLocale('')).toBe('en');
    expect(parseLocale(undefined)).toBe('en');
    expect(parseLocale(null)).toBe('en');
  });

  it('is case-insensitive', () => {
    expect(parseLocale('ID')).toBe('id');
  });
});
