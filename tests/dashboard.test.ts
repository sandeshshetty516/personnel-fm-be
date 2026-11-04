import request from 'supertest';
import { createApp } from '../src/app';
import { closeTestDatabase, connectTestDatabase } from './helpers/db';
import { categoryId, createAccount, financeSetup } from './helpers/finance';

const app = createApp();

beforeAll(connectTestDatabase);
afterAll(closeTestDatabase);

/** Calendar date `months` whole months before today's month, on `day`. Stays in the past. */
function monthsAgo(months: number, day: number) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, day)).toISOString().slice(0, 10);
}

/** The demo journey from the spec (Appendix A), spread over three months. */
async function seeded() {
  const ctx = await financeSetup(app, { name: 'Savings', openingBalancePaise: 0 });
  const cash = await createAccount(ctx.client, { name: 'Cash', accountType: 'CASH', openingBalancePaise: 50_000 });
  const freelance = await categoryId(ctx.client, 'Freelance');
  const add = (body: Record<string, unknown>) =>
    ctx.client
      .post('/api/v1/transactions')
      .send({ accountId: ctx.account.id, ...body })
      .expect(201);

  // Two months ago
  await add({
    type: 'INCOME',
    amountPaise: 8_000_000,
    date: monthsAgo(2, 1),
    title: 'Salary',
    categoryId: ctx.categories.salary,
  });
  await add({
    type: 'EXPENSE',
    amountPaise: 2_000_000,
    date: monthsAgo(2, 5),
    title: 'Rent',
    categoryId: ctx.categories.rent,
  });
  // Last month
  await add({
    type: 'INCOME',
    amountPaise: 8_000_000,
    date: monthsAgo(1, 1),
    title: 'Salary',
    categoryId: ctx.categories.salary,
  });
  await add({
    type: 'INCOME',
    amountPaise: 1_000_000,
    date: monthsAgo(1, 10),
    title: 'Logo design',
    categoryId: freelance,
  });
  await add({
    type: 'EXPENSE',
    amountPaise: 2_000_000,
    date: monthsAgo(1, 5),
    title: 'Rent',
    categoryId: ctx.categories.rent,
  });
  await add({
    type: 'EXPENSE',
    amountPaise: 600_000,
    date: monthsAgo(1, 12),
    title: 'Groceries',
    categoryId: ctx.categories.groceries,
  });
  await add({
    type: 'EXPENSE',
    amountPaise: 400_000,
    date: monthsAgo(1, 15),
    title: 'Fuel',
    categoryId: ctx.categories.fuel,
  });
  await add({
    type: 'EXPENSE',
    amountPaise: 200_000,
    date: monthsAgo(1, 20),
    title: 'Snacks',
    categoryId: ctx.categories.groceries,
    accountId: cash.id,
  });
  // A transfer last month: must not change any income/expense figure.
  await ctx.client
    .post('/api/v1/accounts/transfer')
    .send({ fromAccountId: ctx.account.id, toAccountId: cash.id, amountPaise: 1_000_000, date: monthsAgo(1, 18) })
    .expect(201);

  const lastMonth = {
    from: monthsAgo(1, 1),
    to: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 0)).toISOString().slice(0, 10),
  };
  return { ...ctx, cash, lastMonth };
}

describe('GET /dashboard/summary (FR-055, FR-056)', () => {
  it('requires authentication', async () => {
    await request(app).get('/api/v1/dashboard/summary').expect(401);
  });

  it('reports income, expenses, net, savings rate and total balance for the period', async () => {
    const { client, lastMonth } = await seeded();
    const res = await client.get('/api/v1/dashboard/summary').query(lastMonth).expect(200);

    expect(res.body.data).toEqual({
      period: { ...lastMonth, currency: 'INR' },
      availableCurrencies: ['INR'],
      incomePaise: 9_000_000,
      expensePaise: 3_200_000,
      netPaise: 5_800_000,
      // 5,800,000 / 9,000,000 = 64.44…%
      savingsRatePercent: 64.4,
      // Balances are "now", not period-bound: all income − all expenses + cash opening balance.
      totalBalancePaise: 17_000_000 - 5_200_000 + 50_000,
      activeAccountCount: 2,
      transactionCount: 6,
    });
  });

  it('returns a null savings rate when there is no income', async () => {
    const { client, account, categories } = await financeSetup(app);
    await client
      .post('/api/v1/transactions')
      .send({
        type: 'EXPENSE',
        amountPaise: 100,
        date: monthsAgo(0, 1),
        title: 'X',
        accountId: account.id,
        categoryId: categories.fuel,
      })
      .expect(201);
    const res = await client.get('/api/v1/dashboard/summary').expect(200);
    expect(res.body.data).toMatchObject({ incomePaise: 0, expensePaise: 100, savingsRatePercent: null });
  });

  it('defaults to the current financial month', async () => {
    const { client } = await financeSetup(app);
    await client.patch('/api/v1/users/me').send({ monthStartDay: 1 }).expect(200);
    const res = await client.get('/api/v1/dashboard/summary').expect(200);
    expect(res.body.data.period.from).toBe(monthsAgo(0, 1));
  });

  it('only counts accounts in the selected currency', async () => {
    const { client, categories } = await financeSetup(app);
    const usd = await createAccount(client, { name: 'USD', currency: 'USD', openingBalancePaise: 500 });
    await client
      .post('/api/v1/transactions')
      .send({
        type: 'INCOME',
        amountPaise: 10_000,
        date: monthsAgo(0, 1),
        title: 'Gig',
        accountId: usd.id,
        categoryId: categories.salary,
      })
      .expect(201);

    const inr = await client.get('/api/v1/dashboard/summary').expect(200);
    expect(inr.body.data).toMatchObject({ incomePaise: 0, availableCurrencies: ['INR', 'USD'] });

    const dollars = await client.get('/api/v1/dashboard/summary?currency=USD').expect(200);
    expect(dollars.body.data).toMatchObject({
      incomePaise: 10_000,
      totalBalancePaise: 10_500,
      period: { currency: 'USD' },
    });
  });

  it('validates the period', async () => {
    const { client } = await financeSetup(app);
    await client.get('/api/v1/dashboard/summary?from=2026-01-01').expect(400);
    await client.get('/api/v1/dashboard/summary?from=2026-02-01&to=2026-01-01').expect(400);
  });
});

describe('GET /dashboard/cash-flow and /savings-trend (FR-058)', () => {
  it('returns one bucket per financial month, including empty months, excluding transfers', async () => {
    const { client } = await seeded();
    const res = await client
      .get('/api/v1/dashboard/cash-flow')
      .query({ from: monthsAgo(3, 1), to: monthsAgo(0, 1) })
      .expect(200);

    const buckets = res.body.data.buckets as {
      from: string;
      incomePaise: number;
      expensePaise: number;
      netPaise: number;
    }[];
    expect(buckets.map((b) => b.from)).toEqual([monthsAgo(3, 1), monthsAgo(2, 1), monthsAgo(1, 1), monthsAgo(0, 1)]);
    expect(buckets.map((b) => [b.incomePaise, b.expensePaise, b.netPaise])).toEqual([
      [0, 0, 0],
      [8_000_000, 2_000_000, 6_000_000],
      [9_000_000, 3_200_000, 5_800_000],
      [0, 0, 0],
    ]);
  });

  it('accumulates net savings and rates per month', async () => {
    const { client } = await seeded();
    const res = await client
      .get('/api/v1/dashboard/savings-trend')
      .query({ from: monthsAgo(2, 1), to: monthsAgo(1, 28) })
      .expect(200);
    expect(res.body.data.buckets).toEqual([
      expect.objectContaining({ netPaise: 6_000_000, cumulativeNetPaise: 6_000_000, savingsRatePercent: 75 }),
      expect.objectContaining({ netPaise: 5_800_000, cumulativeNetPaise: 11_800_000, savingsRatePercent: 64.4 }),
    ]);
  });

  it('caps trends at 24 months', async () => {
    const { client } = await financeSetup(app);
    await client.get('/api/v1/dashboard/cash-flow?from=2020-01-01&to=2026-01-01').expect(400);
  });
});

describe('GET /dashboard/category-breakdown (FR-057)', () => {
  it('ranks expense categories with shares that cover the whole', async () => {
    const { client, lastMonth } = await seeded();
    const res = await client.get('/api/v1/dashboard/category-breakdown').query(lastMonth).expect(200);

    expect(res.body.data.totalPaise).toBe(3_200_000);
    expect(
      res.body.data.categories.map(
        (c: { name: string; amountPaise: number; sharePercent: number; transactionCount: number }) => [
          c.name,
          c.amountPaise,
          c.sharePercent,
          c.transactionCount,
        ],
      ),
    ).toEqual([
      ['Rent', 2_000_000, 62.5, 1],
      ['Groceries', 800_000, 25, 2],
      ['Fuel', 400_000, 12.5, 1],
    ]);
  });

  it('can break down income instead', async () => {
    const { client, lastMonth } = await seeded();
    const res = await client
      .get('/api/v1/dashboard/category-breakdown')
      .query({ ...lastMonth, type: 'INCOME' })
      .expect(200);
    expect(res.body.data.categories.map((c: { name: string }) => c.name)).toEqual(['Salary', 'Freelance']);
  });
});

describe('GET /dashboard/recent-transactions (FR-059)', () => {
  it('returns the latest transactions in the period, transfers once', async () => {
    const { client, lastMonth } = await seeded();
    const res = await client
      .get('/api/v1/dashboard/recent-transactions')
      .query({ ...lastMonth, limit: 3 })
      .expect(200);
    expect(res.body.data.transactions.map((t: { title: string }) => t.title)).toEqual([
      'Snacks',
      'Savings → Cash',
      'Fuel',
    ]);
  });
});

describe('data isolation (AC-03)', () => {
  it("never includes another user's data", async () => {
    const { lastMonth } = await seeded();
    const { client } = await financeSetup(app);
    const res = await client.get('/api/v1/dashboard/summary').query(lastMonth).expect(200);
    expect(res.body.data).toMatchObject({ incomePaise: 0, expensePaise: 0, transactionCount: 0 });
    const breakdown = await client.get('/api/v1/dashboard/category-breakdown').query(lastMonth).expect(200);
    expect(breakdown.body.data.categories).toEqual([]);
  });
});
