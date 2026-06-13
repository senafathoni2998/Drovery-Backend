import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { RecurringQueryDto } from './recurring-query.dto';

// Mirror the global ValidationPipe (src/main.ts) so the test catches the
// enableImplicitConversion footgun that silently inverted ?active=false.
const make = (q: Record<string, unknown>) =>
  plainToInstance(RecurringQueryDto, q, { enableImplicitConversion: true });

describe('RecurringQueryDto.activeFilter', () => {
  it('maps active=false to false (not coerced to true)', () => {
    expect(make({ active: 'false' }).activeFilter).toBe(false);
  });

  it('maps active=true to true', () => {
    expect(make({ active: 'true' }).activeFilter).toBe(true);
  });

  it('absent active means no filter (undefined)', () => {
    expect(make({}).activeFilter).toBeUndefined();
  });

  it('rejects a non-boolean active value', async () => {
    const errors = await validate(make({ active: 'garbage' }));
    expect(errors.length).toBeGreaterThan(0);
  });
});
