import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';

/**
 * Localized domain exceptions. Instead of throwing an English literal deep in a
 * service (where no request locale is in scope), throw a stable message KEY (+ params).
 * `AllExceptionsFilter` resolves the request locale at the boundary and translates the
 * key ONCE, so the I18nService stays non-request-scoped (its documented contract) and we
 * don't thread locale through ~30 service methods.
 *
 * Each subclass extends the matching Nest built-in, so `instanceof NotFoundException`
 * (and `rejects.toThrow(NotFoundException)` in specs) still holds. The structured response
 * body carries `messageKey` (+ optional `messageParams` and machine `passthrough` fields
 * like `code`/`reasons`/`retryAfter`); the filter detects `messageKey`, translates it, and
 * strips the internal fields before writing the envelope. A plain HttpException (un-migrated
 * throw) flows through unchanged (English) — so migration is incremental and non-breaking.
 */
export type MessageParams = Record<string, string | number>;

/** Machine-readable fields that must survive onto the response body verbatim (the mobile
 * app / drone client switch on these), alongside the translated `message`. */
export type Passthrough = Record<string, string | number | string[] | boolean>;

function localizedBody(
  status: number,
  messageKey: string,
  messageParams?: MessageParams,
  passthrough?: Passthrough,
): Record<string, unknown> {
  return {
    statusCode: status,
    messageKey,
    ...(messageParams ? { messageParams } : {}),
    ...(passthrough ?? {}),
  };
}

export class AppNotFoundException extends NotFoundException {
  constructor(
    messageKey: string,
    messageParams?: MessageParams,
    passthrough?: Passthrough,
  ) {
    super(
      localizedBody(
        HttpStatus.NOT_FOUND,
        messageKey,
        messageParams,
        passthrough,
      ),
    );
  }
}

export class AppBadRequestException extends BadRequestException {
  constructor(
    messageKey: string,
    messageParams?: MessageParams,
    passthrough?: Passthrough,
  ) {
    super(
      localizedBody(
        HttpStatus.BAD_REQUEST,
        messageKey,
        messageParams,
        passthrough,
      ),
    );
  }
}

export class AppConflictException extends ConflictException {
  constructor(
    messageKey: string,
    messageParams?: MessageParams,
    passthrough?: Passthrough,
  ) {
    super(
      localizedBody(
        HttpStatus.CONFLICT,
        messageKey,
        messageParams,
        passthrough,
      ),
    );
  }
}

export class AppUnauthorizedException extends UnauthorizedException {
  constructor(
    messageKey: string,
    messageParams?: MessageParams,
    passthrough?: Passthrough,
  ) {
    super(
      localizedBody(
        HttpStatus.UNAUTHORIZED,
        messageKey,
        messageParams,
        passthrough,
      ),
    );
  }
}

export class AppForbiddenException extends ForbiddenException {
  constructor(
    messageKey: string,
    messageParams?: MessageParams,
    passthrough?: Passthrough,
  ) {
    super(
      localizedBody(
        HttpStatus.FORBIDDEN,
        messageKey,
        messageParams,
        passthrough,
      ),
    );
  }
}

export class AppUnprocessableEntityException extends UnprocessableEntityException {
  constructor(
    messageKey: string,
    messageParams?: MessageParams,
    passthrough?: Passthrough,
  ) {
    super(
      localizedBody(
        HttpStatus.UNPROCESSABLE_ENTITY,
        messageKey,
        messageParams,
        passthrough,
      ),
    );
  }
}
