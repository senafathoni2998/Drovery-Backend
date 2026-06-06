import { PrismaClient, DeliveryStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool as any) });

async function main() {
  console.log('Seeding database...');

  // Create demo user
  const passwordHash = await bcrypt.hash('demo123', 10);

  const user = await prisma.user.upsert({
    where: { email: 'demo@drovery.com' },
    update: { emailVerified: true, emailVerifiedAt: new Date() },
    create: {
      email: 'demo@drovery.com',
      name: 'Sena',
      phone: '+62 812 3456 7890',
      address:
        'Jalan Ahmad Yani 1 No. 77 RT 12 RW 13, Tanjung Duren, Jakarta',
      passwordHash,
      emailVerified: true,
      emailVerifiedAt: new Date(),
    },
  });

  console.log(`Created user: ${user.email}`);

  // Create sample deliveries
  const deliveries = [
    {
      trackingId: 'DRV-11324572',
      status: DeliveryStatus.IN_TRANSIT,
      fromAddress: 'Jl. Padjajaran Raya No. 21',
      toAddress: 'Jl. Otto Iskandar Dinata No. 21',
      receiver: 'Budi Santoso',
      packages: 'Hamburger & Fries',
      packageSize: 'Small',
      packageWeight: 0.3,
      packageTypes: ['food'],
      pickupDate: new Date(),
      pickupTime: '09:00 AM',
      estimatedPrice: 6,
    },
    {
      trackingId: 'DRV-11324578',
      status: DeliveryStatus.PICKUP_IN_PROGRESS,
      fromAddress: 'Jl. Sudirman No. 5',
      toAddress: 'Jl. Gatot Subroto No. 12',
      receiver: 'Rina Wijaya',
      packages: 'Protein Shakes',
      packageSize: 'Medium',
      packageWeight: 1.2,
      packageTypes: ['food'],
      pickupDate: new Date(),
      pickupTime: '10:00 AM',
      estimatedPrice: 12,
    },
    {
      trackingId: 'DRV-11324573',
      status: DeliveryStatus.DELIVERED,
      fromAddress: 'Jl. Diponegoro No. 88',
      toAddress: 'Jl. Ahmad Yani No. 33',
      receiver: 'Dewi Lestari',
      packages: 'Aspirin (Healthcare)',
      packageSize: 'Small',
      packageWeight: 0.1,
      packageTypes: ['healthcare'],
      pickupDate: new Date(Date.now() - 86400000),
      pickupTime: '08:00 AM',
      estimatedPrice: 7,
    },
    {
      trackingId: 'DRV-11324574',
      status: DeliveryStatus.DELIVERED,
      fromAddress: 'Jl. Merdeka No. 10',
      toAddress: 'Jl. Pahlawan No. 5',
      receiver: 'Ahmad Fauzi',
      packages: 'Fresh Vegetables',
      packageSize: 'Medium',
      packageWeight: 1.0,
      packageTypes: ['food'],
      pickupDate: new Date(Date.now() - 172800000),
      pickupTime: '07:00 AM',
      estimatedPrice: 11,
    },
    {
      trackingId: 'DRV-11324577',
      status: DeliveryStatus.DELIVERED,
      fromAddress: 'Jl. Kebon Sirih No. 15',
      toAddress: 'Jl. Kramat Raya No. 8',
      receiver: 'Putri Handayani',
      packages: 'Books & Stationery',
      packageSize: 'Medium',
      packageWeight: 0.8,
      packageTypes: ['document'],
      pickupDate: new Date(Date.now() - 259200000),
      pickupTime: '14:00 PM',
      estimatedPrice: 10,
    },
    {
      trackingId: 'DRV-CANCELED1',
      status: DeliveryStatus.CANCELED,
      fromAddress: 'Jl. Thamrin No. 1',
      toAddress: 'Jl. Casablanca No. 22',
      receiver: 'Joko Widodo',
      packages: 'Electronics Package',
      packageSize: 'Large',
      packageWeight: 2.5,
      packageTypes: ['electronics'],
      pickupDate: new Date(Date.now() - 86400000),
      pickupTime: '12:00 PM',
      estimatedPrice: 22,
    },
  ];

  for (const delivery of deliveries) {
    await prisma.delivery.upsert({
      where: { trackingId: delivery.trackingId },
      update: {},
      create: {
        ...delivery,
        userId: user.id,
      },
    });
  }

  console.log(`Created ${deliveries.length} deliveries`);

  // Create sample payment methods
  await prisma.paymentMethod.createMany({
    skipDuplicates: true,
    data: [
      {
        userId: user.id,
        stripePaymentMethodId: 'pm_mock_visa',
        network: 'visa',
        last4: '4242',
        holderName: 'Sena',
        expiry: '12/26',
        isDefault: true,
      },
      {
        userId: user.id,
        stripePaymentMethodId: 'pm_mock_mc',
        network: 'mastercard',
        last4: '5353',
        holderName: 'Sena',
        expiry: '08/25',
        isDefault: false,
      },
    ],
  });

  console.log('Created payment methods');
  console.log('Seeding complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
