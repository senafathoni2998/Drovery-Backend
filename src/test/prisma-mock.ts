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
    | 'drone'
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
    | 'flightFrame'
    | 'trackingIdRegistry'
    | 'webhookEvent'
    | 'adminAuditLog'
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
      : K extends
            | '$connect'
            | '$disconnect'
            | 'readWithFallback'
            | '$executeRaw'
            | '$queryRaw'
        ? jest.Mock
        : PrismaService[K];
};

export function createMockPrismaService(): MockPrismaService & {
  /**
   * The object handed to the interactive form of `$transaction` as `tx`.
   *
   * Every model here is the SAME jest.fn as the top-level one — `prisma.delivery
   * .updateMany.mock.calls` still observes a call made through `tx.delivery.updateMany`
   * — but `txClient` is a genuinely DIFFERENT object from `prisma` itself. Without that
   * distinction, `tx` and `prisma` are indistinguishable, and no assertion on a
   * callback's arguments can tell "ran inside the transaction" from "ran afterwards
   * with the same client" — they are the same object either way. A write hoisted out
   * of its transaction (so it can commit a mutation with no co-committed audit row —
   * exactly the regression this whole phase exists to prevent) passes every such
   * assertion unless it is checked against THIS object specifically.
   *
   * Exposed so a spec can assert `expect(callback).toHaveBeenCalledWith(prisma.txClient,
   * ...)` and have it actually discriminate.
   *
   * Typed as `MockPrismaService` MINUS `$transaction`/`readWithFallback`/`txClient`
   * itself — the shallow copy below is taken before any of those three are assigned,
   * so it genuinely lacks them (matching a real `Prisma.TransactionClient`, which has
   * none either). Claiming the full `MockPrismaService` shape here would let
   * `prisma.txClient.$transaction(...)` typecheck while being `undefined` at runtime.
   */
  txClient: Omit<
    MockPrismaService,
    '$transaction' | 'readWithFallback' | 'txClient'
  >;
} {
  const createModelMock = () => {
    // The partitioned tables (deliveries + the co-partitioned children) are read by-id via
    // findFirst (id alone is no longer a unique-where). Make findFirst DELEGATE to findUnique
    // so a spec that stubs only `model.findUnique` (.mockResolvedValue / Once) covers those
    // reads too — while keeping DISTINCT call records (a spec can still stub findFirst
    // directly to override, and a future read wrongly reverted to findUnique stays observable).
    const findUnique = jest.fn();
    return {
      findUnique,
      findFirst: jest.fn((...args: unknown[]) =>
        (findUnique as (...a: unknown[]) => unknown)(...args),
      ),
      findMany: jest.fn(),
      create: jest.fn(),
      // The batch writes ALWAYS resolve to a BatchPayload in real Prisma. Defaulting
      // them to `{ count: 0 }` (rather than undefined) means a service that reads
      // `const { count } = await tx.model.updateMany(...)` — the shape every CAS in
      // this codebase uses — doesn't blow up with a destructuring TypeError in a spec
      // that simply didn't care about the return. Specs needing a real count still
      // override with mockResolvedValue.
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      delete: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn(),
      upsert: jest.fn(),
      groupBy: jest.fn(),
      aggregate: jest.fn(),
    };
  };

  const mock: Record<string, unknown> = {
    user: createModelMock(),
    delivery: createModelMock(),
    drone: createModelMock(),
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
    flightFrame: createModelMock(),
    trackingIdRegistry: createModelMock(),
    webhookEvent: createModelMock(),
    adminAuditLog: createModelMock(),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    // Raw escape hatches used by a few money/reaper paths; default to a benign result.
    $executeRaw: jest.fn().mockResolvedValue(0),
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  // (findFirst→findUnique delegation is now built into createModelMock for every model.)
  //
  // A SHALLOW copy of `mock`, taken BEFORE $transaction/readWithFallback are assigned
  // below — so `txClient` carries every model (the same jest.fn references, hence
  // shared call tracking) but neither of those two PrismaService-only extensions,
  // matching what a real `Prisma.TransactionClient` looks like. Its object identity is
  // its own: `txClient !== mock`, on purpose — see the return type's doc comment.
  const txClient: Record<string, unknown> = { ...mock };

  // Supports both forms: array (Promise.all) AND the interactive callback form, to
  // which we pass `txClient` — a DISTINCT object from `mock` (= `prisma` in a spec) —
  // as the transaction client, so `tx !== prisma` is observable and an audit write
  // hoisted outside its transaction can be told apart from one that ran inside it.
  mock.$transaction = jest.fn((args) =>
    Array.isArray(args) ? Promise.all(args) : args(txClient),
  );
  // Read/write split (PrismaService): in tests there is one DB, so readWithFallback
  // just runs its callback against the same mock. Routed read sites call
  // `prisma.readWithFallback(c => ...)`; their specs can assert it was invoked.
  mock.readWithFallback = jest.fn((fn: (c: unknown) => unknown) => fn(mock));
  mock.txClient = txClient;
  return mock as unknown as MockPrismaService & {
    txClient: Omit<
      MockPrismaService,
      '$transaction' | 'readWithFallback' | 'txClient'
    >;
  };
}
