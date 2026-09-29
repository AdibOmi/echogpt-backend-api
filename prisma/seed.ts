/**
 * Seeds reference data every environment needs: roles, plans, and a first
 * admin account. Idempotent (upserts), so it is safe to run repeatedly.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcrypt';
import { PrismaClient } from '../src/generated/prisma/client.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const [, adminRole] = await Promise.all([
    prisma.role.upsert({
      where: { name: 'USER' },
      update: {},
      create: { name: 'USER', description: 'Regular end user' },
    }),
    prisma.role.upsert({
      where: { name: 'ADMIN' },
      update: {},
      create: { name: 'ADMIN', description: 'Full administrative access' },
    }),
  ]);

  const [freePlan] = await Promise.all([
    prisma.plan.upsert({
      where: { code: 'FREE' },
      update: {},
      create: {
        code: 'FREE',
        name: 'Free',
        description: 'Get started with multi-AI chat',
        priceCents: 0,
        dailyRequestLimit: 20,
        features: ['20 AI requests per day', 'Chat history', 'Web search'],
      },
    }),
    prisma.plan.upsert({
      where: { code: 'PREMIUM' },
      update: {},
      create: {
        code: 'PREMIUM',
        name: 'Premium',
        description: 'For power users',
        priceCents: 999,
        dailyRequestLimit: 1000,
        features: [
          '1000 AI requests per day',
          'All AI providers',
          'Streaming responses',
          'Priority support',
        ],
      },
    }),
  ]);

  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@echogpt.local';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345';
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    await prisma.user.create({
      data: {
        email,
        name: 'Admin',
        passwordHash: await bcrypt.hash(password, 12),
        emailVerifiedAt: new Date(),
        roleId: adminRole.id,
        subscriptions: { create: { planId: freePlan.id } },
      },
    });
    console.log(`Created admin user ${email}`);
  }

  console.log('Seed complete');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
