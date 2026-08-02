import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';

import { AdminSupportController } from './admin-support.controller';
import { AdminService } from './admin.service';

describe('AdminSupportController', () => {
  let controller: AdminSupportController;
  let admin: {
    listTickets: jest.Mock;
    getTicket: jest.Mock;
    replyAsAgent: jest.Mock;
    setTicketStatus: jest.Mock;
  };

  // AGENT, deliberately — this controller is @Roles(Role.AGENT, Role.ADMIN), and an
  // agent (not just an admin) is exactly who is expected to hit these routes.
  const ACTOR = { userId: 'agent-1', role: Role.AGENT };

  beforeEach(async () => {
    admin = {
      listTickets: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      getTicket: jest.fn().mockResolvedValue({ id: 't-1' }),
      replyAsAgent: jest.fn().mockResolvedValue({ id: 'm-1' }),
      setTicketStatus: jest.fn().mockResolvedValue({ id: 't-1' }),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminSupportController],
      providers: [{ provide: AdminService, useValue: admin }],
    }).compile();
    controller = module.get(AdminSupportController);
  });

  afterEach(() => jest.clearAllMocks());

  // Same shape as AdminController's audited mutations: the actor goes first, the id
  // second, and the primitive is unwrapped out of the DTO before it reaches the service.
  describe('the audited support mutations forward the actor', () => {
    it('reply — actor, then id, then the extracted content', async () => {
      await controller.reply(ACTOR, 't-1', { content: 'hello' });
      expect(admin.replyAsAgent).toHaveBeenCalledWith(ACTOR, 't-1', 'hello');
    });

    it('setStatus — actor, then id, then the extracted status', async () => {
      await controller.setStatus(ACTOR, 't-1', { status: 'RESOLVED' as any });
      expect(admin.setTicketStatus).toHaveBeenCalledWith(
        ACTOR,
        't-1',
        'RESOLVED',
      );
    });
  });
});
