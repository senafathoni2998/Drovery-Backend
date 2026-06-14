import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

import { captureException } from '../monitoring/sentry';
import { redactTokenInUrl } from '../redact';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    // Redact any ?token= (the WS handshake carries the JWT in the query string).
    const url = redactTokenInUrl(request.url);

    const body = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: url,
      ...(typeof message === 'string' ? { message } : message),
    };

    if (status >= 500) {
      this.logger.error(`${request.method} ${url}`, exception);
      // Report unexpected server errors to Sentry (no-op when disabled).
      captureException(exception, {
        method: request.method,
        path: url,
      });
    }

    response.status(status).json(body);
  }
}
