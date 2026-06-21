import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Image/object storage gateway with a dev-friendly fallback.
 *
 * - A real provider (S3, Cloudinary, …) uploads and returns a CDN URL when
 *   STORAGE_PROVIDER is configured (integration point left as a TODO).
 * - Otherwise: an uploaded photo is persisted inline as a data URL (no external
 *   service needed), and an auto-generated proof (no photo) gets a deterministic
 *   placeholder image URL. Swap in a provider later with no caller changes.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly config: ConfigService) {}

  get isMock(): boolean {
    return !this.config.get<string>('storage.provider');
  }

  /**
   * Stores a proof-of-delivery photo and returns a URL to it.
   * @param deliveryId used as the storage key / placeholder seed
   * @param base64 raw base64 or a data: URL; null for an auto-generated proof
   */
  // async by seam contract (the real S3/Cloudinary provider awaits an upload);
  // the dev-stub path returns a placeholder synchronously, hence no await yet.
  // eslint-disable-next-line @typescript-eslint/require-await
  async storePodImage(
    deliveryId: string,
    base64: string | null,
  ): Promise<string> {
    if (!this.isMock) {
      // TODO: upload to the configured provider and return the CDN URL.
      this.logger.warn(
        `STORAGE_PROVIDER set but not implemented; using fallback for ${deliveryId}.`,
      );
    }

    if (base64) {
      // Persist inline as a data URL — works in <Image>, no external service.
      return base64.startsWith('data:')
        ? base64
        : `data:image/jpeg;base64,${base64}`;
    }

    // Auto-generated proof with no real photo → deterministic placeholder image.
    const placeholderBase =
      this.config.get<string>('storage.placeholderBase') ??
      'https://picsum.photos/seed';
    return `${placeholderBase}/${deliveryId}/600/400`;
  }
}
