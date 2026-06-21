import {
  SupportChatPublisher,
  supportChatChannel,
  toSupportChatPayload,
} from './support-chat.publisher';

describe('support chat publisher helpers', () => {
  it('builds a stable per-ticket channel name', () => {
    expect(supportChatChannel('t-1')).toBe('support:ticket:t-1:messages');
  });

  it('maps a persisted row to the wire payload (ISO createdAt)', () => {
    const payload = toSupportChatPayload({
      id: 'm-1',
      ticketId: 't-1',
      senderRole: 'SYSTEM',
      senderUserId: null,
      content: 'hello',
      createdAt: new Date('2026-06-12T10:00:00.000Z'),
    });
    expect(payload).toEqual({
      id: 'm-1',
      ticketId: 't-1',
      senderRole: 'SYSTEM',
      senderUserId: null,
      content: 'hello',
      createdAt: '2026-06-12T10:00:00.000Z',
    });
  });
});

describe('SupportChatPublisher.publishMessage', () => {
  const payload = {
    id: 'm-1',
    ticketId: 't-1',
    senderRole: 'USER' as const,
    senderUserId: 'u-1',
    content: 'hi',
    createdAt: '2026-06-12T10:00:00.000Z',
  };

  it('publishes a message:new frame to the ticket channel', async () => {
    const publisher = new SupportChatPublisher({ get: jest.fn() } as any);
    const publish = jest.fn().mockResolvedValue(1);
    (publisher as any).client = { publish };

    await publisher.publishMessage(payload);

    expect(publish).toHaveBeenCalledWith(
      'support:ticket:t-1:messages',
      JSON.stringify({ event: 'message:new', data: payload }),
    );
  });

  it('is fail-open — a Redis publish rejection never throws', async () => {
    const publisher = new SupportChatPublisher({ get: jest.fn() } as any);
    (publisher as any).client = {
      publish: jest.fn().mockRejectedValue(new Error('redis down')),
    };
    await expect(publisher.publishMessage(payload)).resolves.toBeUndefined();
  });
});
