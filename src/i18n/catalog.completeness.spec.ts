import { DeliveryFailureReason } from '@prisma/client';

import { STAGES } from '../deliveries/simulation/simulation.constants';
import { FAQS } from '../support/data/faqs';
import { CATALOGS, SUPPORTED_LOCALES } from './catalog';

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

  for (const locale of SUPPORTED_LOCALES) {
    it(`'${locale}' catalog has every required key`, () => {
      const missing = requiredKeys.filter((k) => !(k in CATALOGS[locale]));
      expect(missing).toEqual([]);
    });
  }

  it('covers all 6 DeliveryFailureReason values plus RETURNING/RETURNED', () => {
    expect(exceptionKeys).toHaveLength(8);
  });
});
