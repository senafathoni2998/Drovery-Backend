import {
  ArgumentsHost,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';

import { AllExceptionsFilter } from './http-exception.filter';
import { I18nService } from '../../i18n/i18n.service';
import {
  AppConflictException,
  AppNotFoundException,
} from '../exceptions/app-exception';

function mockHost(request: Record<string, unknown>): {
  host: ArgumentsHost;
  status: jest.Mock;
  json: jest.Mock;
} {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter(new I18nService());
  const req = (over: Record<string, unknown> = {}) => ({
    url: '/api/v1/x',
    method: 'GET',
    headers: {},
    ...over,
  });

  it('translates an AppException key + params and strips the internal fields', () => {
    const { host, status, json } = mockHost(req());
    filter.catch(
      new AppNotFoundException('validation.min', { property: 'age', min: 18 }),
      host,
    );
    expect(status).toHaveBeenCalledWith(404);
    const body = json.mock.calls[0][0];
    expect(body.message).toBe('age must be at least 18');
    expect(body.statusCode).toBe(404);
    expect(body).not.toHaveProperty('messageKey');
    expect(body).not.toHaveProperty('messageParams');
  });

  it('preserves machine passthrough fields alongside the translated message', () => {
    const { host, json } = mockHost(req());
    filter.catch(
      new AppConflictException(
        'validation.invalid',
        { property: 'credits' },
        { code: 'WALLET_INSUFFICIENT_CREDITS', error: 'Conflict' },
      ),
      host,
    );
    const body = json.mock.calls[0][0];
    expect(body.message).toBe('credits is invalid');
    expect(body.code).toBe('WALLET_INSUFFICIENT_CREDITS');
    expect(body.error).toBe('Conflict');
    expect(body).not.toHaveProperty('messageKey');
  });

  it('resolves the request locale: Accept-Language drives the translation', () => {
    const { host, json } = mockHost(
      req({ headers: { 'accept-language': 'id' } }),
    );
    filter.catch(
      new AppNotFoundException('validation.isNotEmpty', { property: 'nama' }),
      host,
    );
    expect(json.mock.calls[0][0].message).toBe('nama wajib diisi');
  });

  it('prefers an authed user.locale over Accept-Language', () => {
    const { host, json } = mockHost(
      req({ user: { locale: 'id' }, headers: { 'accept-language': 'en' } }),
    );
    filter.catch(
      new AppNotFoundException('validation.isNotEmpty', { property: 'nama' }),
      host,
    );
    expect(json.mock.calls[0][0].message).toBe('nama wajib diisi');
  });

  it('translates a localized validation 400 into a message string[]', () => {
    const { host, status, json } = mockHost(req());
    filter.catch(
      new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        i18nValidationErrors: [
          { key: 'validation.isEmail', params: { property: 'email' } },
          {
            key: 'validation.minLength',
            params: { property: 'password', min: 6 },
          },
        ],
      }),
      host,
    );
    expect(status).toHaveBeenCalledWith(400);
    const body = json.mock.calls[0][0];
    expect(body.message).toEqual([
      'email must be a valid email',
      'password must be at least 6 characters',
    ]);
    expect(body.error).toBe('Bad Request');
    expect(body).not.toHaveProperty('i18nValidationErrors');
  });

  it('passes a plain HttpException through unchanged (un-migrated throw stays English)', () => {
    const { host, json } = mockHost(req());
    filter.catch(new NotFoundException('Delivery not found'), host);
    expect(json.mock.calls[0][0].message).toBe('Delivery not found');
  });

  it('maps a non-HttpException to a generic 500', () => {
    const { host, status, json } = mockHost(req());
    filter.catch(new Error('boom'), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json.mock.calls[0][0].message).toBe('Internal server error');
  });
});
