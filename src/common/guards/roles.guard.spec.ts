import { ForbiddenException } from '@nestjs/common';

import { RolesGuard } from './roles.guard';

const ctx = (user: unknown) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  }) as any;

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let prisma: { user: { findUnique: jest.Mock } };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    prisma = { user: { findUnique: jest.fn() } };
    guard = new RolesGuard(reflector as any, prisma as any);
  });

  it('is inert (true, no DB read) on a route without @Roles', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    await expect(guard.canActivate(ctx({ sub: 'u-1' }))).resolves.toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('allows a matching role (resolved fresh from the DB)', async () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN']);
    prisma.user.findUnique.mockResolvedValue({ role: 'ADMIN' });
    await expect(guard.canActivate(ctx({ sub: 'u-1' }))).resolves.toBe(true);
  });

  it('denies a non-matching role', async () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN']);
    prisma.user.findUnique.mockResolvedValue({ role: 'USER' });
    await expect(guard.canActivate(ctx({ sub: 'u-1' }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('denies when the user is missing / unauthenticated', async () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN']);
    await expect(guard.canActivate(ctx(undefined))).rejects.toThrow(
      ForbiddenException,
    );
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(ctx({ sub: 'gone' }))).rejects.toThrow(
      ForbiddenException,
    );
  });
});
