import { of, lastValueFrom } from 'rxjs';
import { ExecutionContext, CallHandler } from '@nestjs/common';

import { TransformInterceptor } from './transform.interceptor';

describe('TransformInterceptor', () => {
  let interceptor: TransformInterceptor<unknown>;

  beforeEach(() => {
    interceptor = new TransformInterceptor();
  });

  it('should wrap response in { success, data, timestamp }', async () => {
    const mockData = { id: 1, name: 'Test' };
    const context = {} as ExecutionContext;
    const next: CallHandler = { handle: () => of(mockData) };

    const result$ = interceptor.intercept(context, next);
    const result = await lastValueFrom(result$);

    expect(result.success).toBe(true);
    expect(result.data).toEqual(mockData);
    expect(result.timestamp).toBeDefined();
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });

  it('should handle null data', async () => {
    const context = {} as ExecutionContext;
    const next: CallHandler = { handle: () => of(null) };

    const result$ = interceptor.intercept(context, next);
    const result = await lastValueFrom(result$);

    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
  });
});
