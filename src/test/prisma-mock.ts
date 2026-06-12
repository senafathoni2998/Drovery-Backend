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
    ? {
        findUnique: jest.Mock;
        findFirst: jest.Mock;
        findMany: jest.Mock;
        create: jest.Mock;
        update: jest.Mock;
        updateMany: jest.Mock;
        delete: jest.Mock;
        count: jest.Mock;
        upsert: jest.Mock;
      }
    : K extends '$transaction'
      ? jest.Mock
      : K extends '$connect' | '$disconnect'
        ? jest.Mock
        : PrismaService[K];
};

export function createMockPrismaService(): MockPrismaService {
  const createModelMock = () => ({
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
    upsert: jest.fn(),
  });

  return {
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
    $transaction: jest.fn((args) =>
      Array.isArray(args) ? Promise.all(args) : args(),
    ),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  } as unknown as MockPrismaService;
}
