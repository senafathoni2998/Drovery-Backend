import { TrackingPublisher, trackingChannel } from './tracking.publisher';

describe('TrackingPublisher', () => {
  let publisher: TrackingPublisher;
  let client: { publish: jest.Mock };

  beforeEach(() => {
    publisher = new TrackingPublisher({ get: jest.fn() } as any);
    client = { publish: jest.fn().mockResolvedValue(1) };
    // Inject a mock client instead of running onModuleInit (no real Redis).
    (publisher as any).client = client;
  });

  it('publishes to the per-delivery channel with a JSON payload', async () => {
    await publisher.publishUpdate({
      deliveryId: 'd-1',
      droneLat: 1,
      droneLng: 2,
    });

    expect(client.publish).toHaveBeenCalledWith(
      trackingChannel('d-1'),
      JSON.stringify({ deliveryId: 'd-1', droneLat: 1, droneLng: 2 }),
    );
    expect(trackingChannel('d-1')).toBe('delivery:d-1:update');
  });

  it('fails open — a publish error never throws', async () => {
    client.publish.mockRejectedValue(new Error('redis down'));
    await expect(
      publisher.publishUpdate({ deliveryId: 'd-1' }),
    ).resolves.toBeUndefined();
  });
});
