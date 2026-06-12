import { SupportChatSubscriber } from './support-chat.subscriber';

describe('SupportChatSubscriber.dispatch', () => {
  const make = () =>
    new SupportChatSubscriber({ get: jest.fn() } as any);

  it('extracts the ticketId from the channel and forwards the parsed frame', () => {
    const sub = make();
    const handler = jest.fn();
    sub.onUpdate(handler);
    const frame = { event: 'message:new', data: { id: 'm-1', ticketId: 't-1' } };

    sub.dispatch('support:ticket:t-1:messages', JSON.stringify(frame));

    expect(handler).toHaveBeenCalledWith('t-1', frame);
  });

  it('handles ticketIds that contain colons (uuid is colon-free, but be safe)', () => {
    const sub = make();
    const handler = jest.fn();
    sub.onUpdate(handler);
    sub.dispatch(
      'support:ticket:abc-123:messages',
      JSON.stringify({ event: 'message:new', data: {} }),
    );
    expect(handler).toHaveBeenCalledWith('abc-123', expect.anything());
  });

  it('swallows malformed JSON without throwing or calling the handler', () => {
    const sub = make();
    const handler = jest.fn();
    sub.onUpdate(handler);
    expect(() =>
      sub.dispatch('support:ticket:t-1:messages', '{not json'),
    ).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });
});
