import type { Express } from 'express';
import type request from 'supertest';
import { registerClient } from './auth';

type Agent = ReturnType<typeof request.agent>;

/** Calendar date `offsetDays` from today in UTC (tests register users in Asia/Kolkata, so stay ≤ today). */
export function isoDate(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

export async function createAccount(client: Agent, overrides: Record<string, unknown> = {}) {
  const res = await client
    .post('/api/v1/accounts')
    .send({ name: `Account ${Math.random().toString(36).slice(2, 8)}`, accountType: 'SAVINGS', ...overrides })
    .expect(201);
  return res.body.data.account as { id: string; currency: string; name: string };
}

export async function categoryId(client: Agent, name: string) {
  const res = await client.get('/api/v1/categories?includeArchived=true').expect(200);
  const found = (res.body.data.categories as { id: string; name: string }[]).find((c) => c.name === name);
  if (!found) throw new Error(`No category named ${name}`);
  return found.id;
}

export async function balanceOf(client: Agent, accountId: string): Promise<number> {
  const res = await client.get(`/api/v1/accounts/${accountId}`).expect(200);
  return res.body.data.account.currentBalancePaise;
}

/** A registered user with one savings account and the ids of a few default categories. */
export async function financeSetup(app: Express, accountOverrides: Record<string, unknown> = {}) {
  const ctx = await registerClient(app);
  const account = await createAccount(ctx.client, {
    name: 'Savings',
    openingBalancePaise: 1_000_000,
    ...accountOverrides,
  });
  const [salary, rent, groceries, fuel] = await Promise.all([
    categoryId(ctx.client, 'Salary'),
    categoryId(ctx.client, 'Rent'),
    categoryId(ctx.client, 'Groceries'),
    categoryId(ctx.client, 'Fuel'),
  ]);
  return { ...ctx, account, categories: { salary, rent, groceries, fuel } };
}
