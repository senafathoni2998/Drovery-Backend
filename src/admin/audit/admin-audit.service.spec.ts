import { AdminAuditAction, AdminAuditTargetType, Role } from '@prisma/client';

import { createMockPrismaService } from '../../test/prisma-mock';
import { AdminAuditService } from './admin-audit.service';
import { diffAllowed, pickAllowed } from './admin-audit.constants';

describe('AdminAuditService', () => {
  let prisma: ReturnType<typeof createMockPrismaService>;
  let service: AdminAuditService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new AdminAuditService();
  });

  it('writes the row through the CALLER transaction, not its own client', async () => {
    // The whole guarantee: the audit row commits with the mutation or not at all. A
    // service holding its own PrismaService would commit independently and silently
    // reintroduce the best-effort log this increment exists to replace.
    await service.recordWithinTx(prisma as any, {
      actorUserId: 'admin-1',
      actorRole: Role.ADMIN,
      action: AdminAuditAction.DRONE_UPDATE,
      targetType: AdminAuditTargetType.DRONE,
      targetId: 'drone-7',
      before: { airworthy: true },
      after: { airworthy: false },
    });

    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: 'admin-1',
        actorRole: Role.ADMIN,
        action: AdminAuditAction.DRONE_UPDATE,
        targetType: AdminAuditTargetType.DRONE,
        targetId: 'drone-7',
        before: { airworthy: true },
        after: { airworthy: false },
        args: undefined,
      },
    });
  });

  it('propagates a write failure instead of swallowing it', async () => {
    // Swallowing here would leave the mutation committed with no record — exactly the
    // failure mode a co-committed audit row exists to make impossible.
    prisma.adminAuditLog.create.mockRejectedValue(new Error('disk full'));

    await expect(
      service.recordWithinTx(prisma as any, {
        actorUserId: 'admin-1',
        actorRole: Role.ADMIN,
        action: AdminAuditAction.USER_ROLE_SET,
        targetType: AdminAuditTargetType.USER,
        targetId: 'user-2',
      }),
    ).rejects.toThrow('disk full');
  });
});

describe('audit field allowlist', () => {
  it('keeps only the declared fields', () => {
    const picked = pickAllowed(AdminAuditAction.DRONE_CREATE, {
      serial: 'DRV-001',
      rangeKm: 12,
      ingestKeyHash: 'secret-hash',
    });

    // Allowlist, not denylist: a field added to a DTO later cannot start appearing
    // in the audit log until someone declares it.
    expect(picked).toEqual({ serial: 'DRV-001', rangeKm: 12 });
  });

  it('is undefined rather than empty when nothing survives', () => {
    expect(
      pickAllowed(AdminAuditAction.DRONE_CREATE, { ingestKeyHash: 'x' }),
    ).toBeUndefined();
    expect(pickAllowed(AdminAuditAction.DRONE_CREATE, null)).toBeUndefined();
  });

  it('diffs only the fields that actually changed', () => {
    const { before, after } = diffAllowed(
      AdminAuditAction.DRONE_UPDATE,
      { airworthy: true, status: 'AVAILABLE', serial: 'DRV-001' },
      { airworthy: false, status: 'AVAILABLE', serial: 'DRV-001' },
    );

    // An unchanged field in the diff is noise that makes a real change harder to see.
    expect(before).toEqual({ airworthy: true });
    expect(after).toEqual({ airworthy: false });
  });

  it('reports no diff when nothing changed', () => {
    const { before, after } = diffAllowed(
      AdminAuditAction.DRONE_UPDATE,
      { airworthy: true },
      { airworthy: true },
    );

    expect(before).toBeUndefined();
    expect(after).toBeUndefined();
  });

  it('never captures a support reply body, only its length', () => {
    // The content already lives in support_chat_messages with its own senderUserId.
    // Copying customer prose here widens what an audit read exposes for no forensic gain.
    const picked = pickAllowed(AdminAuditAction.SUPPORT_TICKET_REPLY, {
      content: 'my card was charged twice, here is my number 0812...',
      contentLength: 51,
    });

    expect(picked).toEqual({ contentLength: 51 });
  });
});
