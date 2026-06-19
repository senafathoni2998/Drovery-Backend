import { PrismaService } from '../prisma/prisma.service';

type MockPrismaService = {
  [K in keyof PrismaService]: K extends
    | 'user'
    | 'delivery'
    | 'deliveryTracking'
    | 'paymentMethod'
    | 'payment'
    | 'notification'
    | 'device'
    | 'workflowStepCompletion'
    | 'supportTicket'
    | 'passwordResetToken'
    | 'proofOfDelivery'
    | 'emailVerificationToken'
    | 'refreshToken'
    | 'savedAddress'
    | 'deliveryRating'
    | 'notificationPreference'
    | 'supportChatMessage'
    | 'recurringDelivery'
    | 'promoCode'
    | 'promoRedemption'
    | 'walletTransaction'
    | 'referral'
    | 'favorite'
    | 'droneCommand'
    | 'trackingIdRegistry'
    ? {
        findUnique: jest.Mock;
        findFirst: jest.Mock;
        findMany: jest.Mock;
        create: jest.Mock;
        createMany: jest.Mock;
        update: jest.Mock;
        updateMany: jest.Mock;
        delete: jest.Mock;
        deleteMany: jest.Mock;
        count: jest.Mock;
        upsert: jest.Mock;
        groupBy: jest.Mock;
        aggregate: jest.Mock;
      }
    : K extends '$transaction'
      ? jest.Mock
      : K extends '$connect' | '$disconnect' | 'readWithFallback'
        ? jest.Mock
        : PrismaService[K];
};

export function createMockPrismaService(): MockPrismaService {
  const createModelMock = () => ({
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
    upsert: jest.fn(),
    groupBy: jest.fn(),
    aggregate: jest.fn(),
  });

  const mock: Record<string, unknown> = {
    user: createModelMock(),
    delivery: createModelMock(),
    deliveryTracking: createModelMock(),
    paymentMethod: createModelMock(),
    payment: createModelMock(),
    notification: createModelMock(),
    device: createModelMock(),
    workflowStepCompletion: createModelMock(),
    supportTicket: createModelMock(),
    passwordResetToken: createModelMock(),
    proofOfDelivery: createModelMock(),
    emailVerificationToken: createModelMock(),
    refreshToken: createModelMock(),
    savedAddress: createModelMock(),
    deliveryRating: createModelMock(),
    notificationPreference: createModelMock(),
    supportChatMessage: createModelMock(),
    recurringDelivery: createModelMock(),
    promoCode: createModelMock(),
    promoRedemption: createModelMock(),
    walletTransaction: createModelMock(),
    referral: createModelMock(),
    favorite: createModelMock(),
    droneCommand: createModelMock(),
    trackingIdRegistry: createModelMock(),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  };
  // `deliveries` is partitioned (composite PK), so the service reads it via findFirst
  // (id alone is no longer a unique-where). Make delivery.findFirst DELEGATE to
  // delivery.findUnique rather than BE the same fn: existing specs that stub
  // `delivery.findUnique` (.mockResolvedValue / Once) still flow through unchanged, but
  // the two now have distinct call records — so a future read wrongly reverted to
  // findUnique on the partitioned table stays observable (it wouldn't hit findFirst).
  // The composite-PK findByTrackingId fetch calls delivery.findUnique directly.
  const deliveryMock = mock.delivery as ReturnType<typeof createModelMock>;
  deliveryMock.findFirst = jest.fn((...args: unknown[]) =>
    (deliveryMock.findUnique as (...a: unknown[]) => unknown)(...args),
  );
  // Supports both forms: array (Promise.all) AND the interactive callback form,
  // to which we pass the same mock as the transaction client (so tx.model.* works).
  mock.$transaction = jest.fn((args) =>
    Array.isArray(args) ? Promise.all(args) : args(mock),
  );
  // Read/write split (PrismaService): in tests there is one DB, so readWithFallback
  // just runs its callback against the same mock. Routed read sites call
  // `prisma.readWithFallback(c => ...)`; their specs can assert it was invoked.
  mock.readWithFallback = jest.fn((fn: (c: unknown) => unknown) => fn(mock));
  return mock as unknown as MockPrismaService;
}
