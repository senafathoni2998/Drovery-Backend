import { EventEmitter } from 'events';

import { SupportChatSubscriber } from './support-chat.subscriber';

describe('SupportChatSubscriber.dispatch', () => {
  const make = () => new SupportChatSubscriber({ get: jest.fn() } as any);

  it('extracts the ticketId from the channel and forwards the parsed frame', () => {
    const sub = make();
    const handler = jest.fn();
    sub.onUpdate(handler);
    const frame = {
      event: 'message:new',
      data: { id: 'm-1', ticketId: 't-1' },
    };

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

describe('SupportChatSubscriber channel (un)subscription', () => {
  const channel = 'support:ticket:t-1:messages';

  it('uses classic subscribe/unsubscribe in standard mode (default)', () => {
    const sub = new SupportChatSubscriber({ get: jest.fn() } as any);
    const client = {
      subscribe: jest.fn().mockResolvedValue(1),
      unsubscribe: jest.fn().mockResolvedValue(1),
    };
    (sub as any).sub = client;

    sub.subscribeToTicket('t-1');
    sub.unsubscribeFromTicket('t-1');

    expect(client.subscribe).toHaveBeenCalledWith(channel);
    expect(client.unsubscribe).toHaveBeenCalledWith(channel);
  });

  it('uses sharded S-commands when mode is sharded', () => {
    const sub = new SupportChatSubscriber({ get: jest.fn() } as any);
    (sub as any).mode = 'sharded';
    const client = {
      ssubscribe: jest.fn().mockResolvedValue(1),
      sunsubscribe: jest.fn().mockResolvedValue(1),
    };
    (sub as any).sub = client;

    sub.subscribeToTicket('t-1');
    sub.unsubscribeFromTicket('t-1');

    expect(client.ssubscribe).toHaveBeenCalledWith(channel);
    expect(client.sunsubscribe).toHaveBeenCalledWith(channel);
  });
});

describe('SupportChatSubscriber.wireMessageListener', () => {
  // Wiring the dispatch listener on the wrong event silently receives nothing in
  // production — assert the mode picks the event ('message' / 'smessage').
  const wire = (mode: string) => {
    const sub = new SupportChatSubscriber({ get: jest.fn() } as any);
    (sub as any).mode = mode;
    const spy = jest.spyOn(sub, 'dispatch').mockImplementation(() => undefined);
    const emitter = new EventEmitter();
    (sub as any).wireMessageListener(emitter);
    return { spy, emitter };
  };

  it('standard mode registers dispatch on "message" only', () => {
    const { spy, emitter } = wire('standard');
    emitter.emit('smessage', 'support:ticket:t-1:messages', '{}'); // ignored
    expect(spy).not.toHaveBeenCalled();
    emitter.emit('message', 'support:ticket:t-1:messages', '{}');
    expect(spy).toHaveBeenCalledWith('support:ticket:t-1:messages', '{}');
  });

  it('sharded mode registers dispatch on "smessage" only', () => {
    const { spy, emitter } = wire('sharded');
    emitter.emit('message', 'support:ticket:t-1:messages', '{}'); // ignored
    expect(spy).not.toHaveBeenCalled();
    emitter.emit('smessage', 'support:ticket:t-1:messages', '{}');
    expect(spy).toHaveBeenCalledWith('support:ticket:t-1:messages', '{}');
  });
});
