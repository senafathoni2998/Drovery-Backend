import { DeliveryFailureReason } from '@prisma/client';

import { STAGES } from '../deliveries/simulation/simulation.constants';
import { FAQS } from '../support/data/faqs';
import { CATALOGS, DEFAULT_LOCALE, SUPPORTED_LOCALES } from './catalog';
import { VALIDATION_KEYS } from './catalog/keys';

/**
 * Drift guard: every message key the app renders MUST exist in EVERY supported
 * locale. If someone adds a delivery stage, a failure reason, or an FAQ without a
 * catalog entry, this fails CI instead of printing a raw key in production.
 */
describe('i18n catalog completeness', () => {
  // Build the full set of keys the code references.
  const requiredKeys: string[] = [];

  for (const stage of STAGES) {
    for (const part of ['title', 'body', 'droneStatus']) {
      requiredKeys.push(`notification.stage.${stage.status}.${part}`);
    }
  }

  const exceptionKeys = [
    ...Object.values(DeliveryFailureReason),
    'RETURNING',
    'RETURNED',
  ];
  for (const key of exceptionKeys) {
    for (const part of ['title', 'body', 'droneStatus']) {
      requiredKeys.push(`notification.exception.${key}.${part}`);
    }
  }

  requiredKeys.push(
    'email.passwordReset.subject',
    'email.passwordReset.body',
    'email.verification.subject',
    'email.verification.body',
    'support.autoAck',
  );

  for (const faq of FAQS) {
    requiredKeys.push(`faq.${faq.id}.question`, `faq.${faq.id}.answer`);
  }

  // Validation keys (one per class-validator constraint the factory maps) aren't derivable
  // from a code enum, so they're enumerated from the shared VALIDATION_KEYS source.
  requiredKeys.push(...VALIDATION_KEYS);

  for (const locale of SUPPORTED_LOCALES) {
    it(`'${locale}' catalog has every required key`, () => {
      const missing = requiredKeys.filter((k) => !(k in CATALOGS[locale]));
      expect(missing).toEqual([]);
    });
  }

  // Stronger than per-key presence: every locale must define EXACTLY the same key set as
  // English (the source of truth). This catches an `id` key that's missing OR stale/extra —
  // a per-key-fallback gap (id silently English) that the requiredKeys checks above can't
  // see, and any future error.* key added to en.ts but forgotten in id.ts.
  const enKeys = Object.keys(CATALOGS[DEFAULT_LOCALE]).sort();
  for (const locale of SUPPORTED_LOCALES) {
    if (locale === DEFAULT_LOCALE) continue;
    it(`'${locale}' catalog defines exactly the English key set (no missing/extra)`, () => {
      expect(Object.keys(CATALOGS[locale]).sort()).toEqual(enKeys);
    });
  }

  it('covers all 6 DeliveryFailureReason values plus RETURNING/RETURNED', () => {
    expect(exceptionKeys).toHaveLength(8);
  });
});
