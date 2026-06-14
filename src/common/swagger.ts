import { INestApplication } from '@nestjs/common';
import {
  ApiProperty,
  DocumentBuilder,
  getSchemaPath,
  OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';

/**
 * The uniform success envelope every 2xx response is wrapped in by
 * TransformInterceptor. Every documented 2xx response is rewritten (see
 * applyEnvelopeAndErrors) to `allOf [ApiEnvelopeDto, { data: <inner schema> }]`,
 * so a generated client reads `response.data.<field>` — matching runtime.
 */
export class ApiEnvelopeDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({
    description: 'The endpoint payload (shape shown per operation)',
  })
  data: unknown;

  @ApiProperty({
    example: '2026-06-14T09:30:00.000Z',
    description: 'ISO-8601 server time the response was produced',
  })
  timestamp: string;
}

/** The uniform error envelope produced by AllExceptionsFilter (non-2xx). */
export class ApiErrorDto {
  @ApiProperty({ example: 422 })
  statusCode: number;

  @ApiProperty({ example: '2026-06-14T09:30:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: '/api/v1/deliveries' })
  path: string;

  @ApiProperty({
    example: 'Route is outside the serviceable area',
    description: 'string, or a validation-error detail object',
  })
  message: unknown;
}

const DESCRIPTION = [
  'Drone-delivery backend API.',
  '',
  '**Response envelope** — every 2xx response is `allOf [ApiEnvelopeDto, { data }]`:',
  '`{ "success": true, "data": <the per-operation schema>, "timestamp": "<ISO>" }`.',
  'Errors use ApiErrorDto: `{ "statusCode", "timestamp", "path", "message" }`.',
  '',
  '**Auth** — most routes require a Bearer JWT (use **Authorize** with an access',
  'token from `POST /auth/login`). Routes shown without a lock are public. The drone',
  'ingest routes `/ingest/*` are machine-authed with the `x-ingest-key` header',
  '(+ optional timestamped HMAC), never a user JWT.',
  '',
  '**Realtime** — live tracking (`/`) and support chat (`/ws/support`) are WebSocket',
  'gateways (JWT in the `?token=` handshake) and are not described here.',
  '',
  'Rate-limited to 100 req/min/IP (tighter on `/auth`).',
].join('\n');

const HTTP_METHODS = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
] as const;

/**
 * Rewrites the generated document so the spec matches runtime: (1) wraps every
 * documented 2xx response schema in the `{ success, data, timestamp }` envelope
 * TransformInterceptor produces, and (2) injects the standard error responses
 * (400/401/500 → ApiErrorDto). This also makes ApiEnvelopeDto + ApiErrorDto
 * referenced models rather than orphans. Public ops (security `[{}]`) get no 401.
 */
function applyEnvelopeAndErrors(doc: OpenAPIObject): OpenAPIObject {
  const envelopeRef = { $ref: getSchemaPath(ApiEnvelopeDto) };
  const errorContent = {
    'application/json': { schema: { $ref: getSchemaPath(ApiErrorDto) } },
  };
  for (const pathItem of Object.values(doc.paths)) {
    for (const method of HTTP_METHODS) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const op = (pathItem as Record<string, any>)[method];
      if (!op || typeof op !== 'object') continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const responses: Record<string, any> = op.responses ?? {};

      for (const [code, resp] of Object.entries(responses)) {
        if (!code.startsWith('2')) continue;
        const json = resp?.content?.['application/json'];
        if (json?.schema) {
          json.schema = {
            allOf: [
              envelopeRef,
              {
                type: 'object',
                required: ['data'],
                properties: { data: json.schema },
              },
            ],
          };
        }
      }

      // `[{}]` (empty requirement) = a @PublicApi() route → no 401.
      const isPublic =
        Array.isArray(op.security) &&
        op.security.some(
          (r: Record<string, unknown>) => Object.keys(r).length === 0,
        );
      const addErr = (code: string, description: string) => {
        if (!responses[code])
          responses[code] = { description, content: errorContent };
      };
      addErr('400', 'Validation failed / bad request');
      if (!isPublic) addErr('401', 'Missing or invalid authentication');
      addErr('500', 'Unexpected server error');
      op.responses = responses;
    }
  }
  return doc;
}

/** Builds the OpenAPI document (no HTTP mount) — shared by setup + tests. */
export function buildSwaggerDocument(app: INestApplication): OpenAPIObject {
  // NOTE: no addServer() — createDocument runs after setGlobalPrefix, so the
  // global prefix is already baked into every path key (/api/v1/...). Adding a
  // server of `/api/v1` too would double it (Try-it-out → /api/v1/api/v1/...).
  const config = new DocumentBuilder()
    .setTitle('Drovery API')
    .setDescription(DESCRIPTION)
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token from POST /auth/login',
      },
      'access-token',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'x-ingest-key',
        in: 'header',
        description: 'Shared drone-gateway key for /ingest/* (fail-closed)',
      },
      'ingest-key',
    )
    // Global default: Bearer. Public routes (see description) ignore it; the drone
    // ingest routes additionally accept the ingest-key scheme.
    .addSecurityRequirements('access-token')
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    extraModels: [ApiEnvelopeDto, ApiErrorDto],
  });
  return applyEnvelopeAndErrors(document);
}

/**
 * Mounts interactive API docs at `${prefix}/docs` (+ the raw OpenAPI JSON at
 * `${prefix}/docs-json`). ON by default — this backend is a portfolio showcase, so
 * the browsable docs are intentionally published even in prod; set
 * SWAGGER_ENABLED=false to keep the surface unpublished in a locked-down
 * deployment. Returns the mounted path, or null when disabled.
 */
export function setupSwagger(
  app: INestApplication,
  prefix: string,
): string | null {
  if (process.env.SWAGGER_ENABLED === 'false') return null;

  const document = buildSwaggerDocument(app);
  const path = `${prefix}/docs`;
  SwaggerModule.setup(path, app, document, {
    swaggerOptions: { persistAuthorization: true },
    customSiteTitle: 'Drovery API Docs',
  });
  return path;
}
