import { Global, Module } from '@nestjs/common';

import { I18nService } from './i18n.service';

/**
 * @Global so the single I18nService instance is available to every module — the
 * request-side modules AND the worker's module graph — without each adding it to
 * its imports. I18nService is a pure default-scope singleton, so sharing one
 * instance everywhere is correct and cheap.
 */
@Global()
@Module({
  providers: [I18nService],
  exports: [I18nService],
})
export class I18nModule {}
