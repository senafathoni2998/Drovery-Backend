import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { StorageService } from './storage.service';

describe('StorageService (mock mode)', () => {
  let service: StorageService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<StorageService>(StorageService);
  });

  it('is in mock mode when no provider is configured', () => {
    expect(service.isMock).toBe(true);
  });

  it('returns a deterministic placeholder image when no photo is provided', async () => {
    const url = await service.storePodImage('d-1', null);
    expect(url).toBe('https://picsum.photos/seed/d-1/600/400');
  });

  it('wraps raw base64 as a data URL', async () => {
    const url = await service.storePodImage('d-1', 'AAAA');
    expect(url).toBe('data:image/jpeg;base64,AAAA');
  });

  it('passes an existing data URL through unchanged', async () => {
    const url = await service.storePodImage(
      'd-1',
      'data:image/png;base64,BBBB',
    );
    expect(url).toBe('data:image/png;base64,BBBB');
  });
});
