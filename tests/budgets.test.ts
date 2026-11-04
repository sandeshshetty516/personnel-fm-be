import request from 'supertest';
import { createApp } from '../src/app';
import { closeTestDatabase, connectTestDatabase } from './helpers/db';
import { createAccount, financeSetup } from './helpers/finance';

const app = createApp();

beforeAll(connectTestDatabase);
afterAll(closeTestDatabase);

/** A past calendar date `months` months back, on `day` (UTC; tests users live in Asia/Kolkata). */
function monthsAgo(months: number, day: number) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, day)).toISOString().slice(0, 10);
}

async function seeded() {
  const ctx = await financeSetup(app, { name: 'Savings', openingBalancePaise: 0 });
  const add = (body: Record<string, unknown>) =>
    ctx.client
      .post('/api/v1/transactions')
      .send({ accountId: ctx.account.id, ...body })
      .expect(201);

  // Last month: groceries 6,000 + 3,000, fuel 2,000, rent 20,000. Salary must never count.
  await add({
    type: 'INCOME',
    amountPaise: 8_000_000,
    date: monthsAgo(1, 1),
    title: 'Salary',
    categoryId: ctx.categories.salary,
  });
  await add({
    type: 'EXPENSE',
    amountPaise: 600_000,
    date: monthsAgo(1, 3),
    title: 'Groceries',
    categoryId: ctx.categories.groceries,
  });
  await add({
    type: 'EXPENSE',
    amountPaise: 300_000,
    date: monthsAgo(1, 20),
    title: 'Groceries',
    categoryId: ctx.categories.groceries,
  });
  await add({
    type: 'EXPENSE',
    amountPaise: 200_000,
    date: monthsAgo(1, 5),
    title: 'Fuel',
    categoryId: ctx.categories.fuel,
  });
  await add({
    type: 'EXPENSE',
    amountPaise: 2_000_000,
    date: monthsAgo(1, 2),
    title: 'Rent',
    categoryId: ctx.categories.rent,
  });
  // Two months ago (outside last month's period).
  await add({
    type: 'EXPENSE',
    amountPaise: 999_900,
    date: monthsAgo(2, 15),
    title: 'Old',
    categoryId: ctx.categories.groceries,
  });
  // A transfer last month: never an expense.
  const cash = await createAccount(ctx.client, { name: 'Cash', accountType: 'CASH' });
  await ctx.client
    .post('/api/v1/accounts/transfer')
    .send({ fromAccountId: ctx.account.id, toAccountId: cash.id, amountPaise: 1_000_000, date: monthsAgo(1, 10) })
    .expect(201);
  return { ...ctx, cash };
}

const monthlyBudget = (categories: { groceries: string; fuel: string }) => ({
  name: 'Household',
  period: 'MONTHLY',
  amountPaise: 3_000_000,
  startDate: monthsAgo(3, 1),
  categoryLimits: [
    { categoryId: categories.groceries, amountPaise: 1_000_000 },
    { categoryId: categories.fuel, amountPaise: 200_000 },
  ],
});

describe('budget CRUD (FR-032, FR-033)', () => {
  it('requires authentication', async () => {
    await request(app).get('/api/v1/budgets').expect(401);
  });

  it('creates a monthly budget with category limits and default alert thresholds', async () => {
    const { client, categories } = await financeSetup(app);
    const res = await client.post('/api/v1/budgets').send(monthlyBudget(categories)).expect(201);
    expect(res.body.data.budget).toMatchObject({
      name: 'Household',
      period: 'MONTHLY',
      currency: 'INR',
      amountPaise: 3_000_000,
      alertThresholds: [50, 80, 100],
      endDate: null,
    });
    expect(res.body.data.budget.categoryLimits).toHaveLength(2);
  });

  it.each([
    [{ amountPaise: 0 }, 'amountPaise'],
    [{ period: 'WEEKLY' }, 'period'],
    [{ period: 'CUSTOM' }, 'endDate'],
    [{ endDate: '2000-01-01' }, 'endDate'],
    [{ alertThresholds: [0] }, 'alertThresholds.0'],
  ])('validates input %#', async (override, field) => {
    const { client, categories } = await financeSetup(app);
    const res = await client
      .post('/api/v1/budgets')
      .send({ ...monthlyBudget(categories), ...override })
      .expect(400);
    expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: field })]));
  });

  it('rejects duplicate, income or foreign categories in limits', async () => {
    const { client, categories } = await financeSetup(app);
    const other = await financeSetup(app);
    const base = monthlyBudget(categories);

    await client
      .post('/api/v1/budgets')
      .send({ ...base, categoryLimits: [base.categoryLimits[0], base.categoryLimits[0]] })
      .expect(400);
    await client
      .post('/api/v1/budgets')
      .send({ ...base, categoryLimits: [{ categoryId: categories.salary, amountPaise: 100 }] })
      .expect(400);
    await client
      .post('/api/v1/budgets')
      .send({ ...base, categoryLimits: [{ categoryId: other.categories.fuel, amountPaise: 100 }] })
      .expect(404);
  });

  it('sorts and de-duplicates thresholds, updates and deletes', async () => {
    const { client, categories } = await financeSetup(app);
    const created = await client
      .post('/api/v1/budgets')
      .send({ ...monthlyBudget(categories), alertThresholds: [100, 75, 75] })
      .expect(201);
    const id = created.body.data.budget.id;
    expect(created.body.data.budget.alertThresholds).toEqual([75, 100]);

    const updated = await client
      .patch(`/api/v1/budgets/${id}`)
      .send({ name: 'Home', amountPaise: 4_000_000 })
      .expect(200);
    expect(updated.body.data.budget).toMatchObject({ name: 'Home', amountPaise: 4_000_000 });

    // Switching to CUSTOM without an end date is refused.
    await client.patch(`/api/v1/budgets/${id}`).send({ period: 'CUSTOM' }).expect(400);

    await client.delete(`/api/v1/budgets/${id}`).expect(200);
    await client.get(`/api/v1/budgets/${id}`).expect(404);
  });
});

describe('utilisation (FR-034 – FR-037, AC-08)', () => {
  it('counts only eligible expenses in the budget period, per category and overall', async () => {
    const { client, categories } = await seeded();
    const { body } = await client.post('/api/v1/budgets').send(monthlyBudget(categories)).expect(201);

    const res = await client
      .get(`/api/v1/budgets/${body.data.budget.id}/summary`)
      .query({ date: monthsAgo(1, 15) })
      .expect(200);
    const { summary } = res.body.data;

    expect(summary.period).toEqual({ from: monthsAgo(1, 1), to: expect.any(String) });
    expect(summary.overall).toEqual({
      limitPaise: 3_000_000,
      spentPaise: 3_100_000,
      remainingPaise: -100_000,
      utilizationPercent: 103.3,
      reachedThreshold: 100,
    });
    expect(summary.categories).toEqual([
      expect.objectContaining({
        name: 'Groceries',
        spentPaise: 900_000,
        remainingPaise: 100_000,
        utilizationPercent: 90,
        reachedThreshold: 80,
      }),
      expect.objectContaining({
        name: 'Fuel',
        spentPaise: 200_000,
        remainingPaise: 0,
        utilizationPercent: 100,
        reachedThreshold: 100,
      }),
    ]);
    // Rent has no category limit.
    expect(summary.unbudgetedSpentPaise).toBe(2_000_000);
    expect(summary.elapsedPercent).toBeGreaterThan(0);
  });

  it('reflects a newly added expense immediately', async () => {
    const { client, account, categories } = await seeded();
    const { body } = await client.post('/api/v1/budgets').send(monthlyBudget(categories)).expect(201);
    const id = body.data.budget.id;
    const before = (await client.get(`/api/v1/budgets/${id}/summary?date=${monthsAgo(1, 15)}`).expect(200)).body.data
      .summary.overall.spentPaise;

    await client
      .post('/api/v1/transactions')
      .send({
        type: 'EXPENSE',
        amountPaise: 12_345,
        date: monthsAgo(1, 25),
        title: 'More fuel',
        accountId: account.id,
        categoryId: categories.fuel,
      })
      .expect(201);

    const after = (await client.get(`/api/v1/budgets/${id}/summary?date=${monthsAgo(1, 15)}`).expect(200)).body.data
      .summary.overall.spentPaise;
    expect(after - before).toBe(12_345);
  });

  it('does not apply a monthly budget before its start month', async () => {
    const { client, categories } = await seeded();
    const { body } = await client
      .post('/api/v1/budgets')
      .send({ ...monthlyBudget(categories), startDate: monthsAgo(0, 1) })
      .expect(201);
    const res = await client.get(`/api/v1/budgets/${body.data.budget.id}/summary?date=${monthsAgo(1, 15)}`).expect(200);
    expect(res.body.data.summary.period).toBeNull();
    expect(res.body.data.summary.overall.spentPaise).toBe(0);
  });

  it('covers exactly the custom date range', async () => {
    const { client } = await seeded();
    const { body } = await client
      .post('/api/v1/budgets')
      .send({
        name: 'Trip',
        period: 'CUSTOM',
        amountPaise: 500_000,
        startDate: monthsAgo(1, 4),
        endDate: monthsAgo(1, 6),
      })
      .expect(201);
    const res = await client.get(`/api/v1/budgets/${body.data.budget.id}/summary?date=${monthsAgo(1, 5)}`).expect(200);
    // Only fuel on day 5 falls in 4..6.
    expect(res.body.data.summary.overall.spentPaise).toBe(200_000);
  });

  it('lists budgets with their summary for a given date', async () => {
    const { client, categories } = await seeded();
    await client.post('/api/v1/budgets').send(monthlyBudget(categories)).expect(201);
    const res = await client.get(`/api/v1/budgets?date=${monthsAgo(1, 15)}`).expect(200);
    expect(res.body.data.budgets).toHaveLength(1);
    expect(res.body.data.budgets[0].summary.overall.spentPaise).toBe(3_100_000);
  });
});

describe('data isolation (AC-03)', () => {
  it("cannot read, change or delete another user's budget", async () => {
    const owner = await financeSetup(app);
    const intruder = await financeSetup(app);
    const { body } = await owner.client.post('/api/v1/budgets').send(monthlyBudget(owner.categories)).expect(201);
    const id = body.data.budget.id;

    await intruder.client.get(`/api/v1/budgets/${id}`).expect(404);
    await intruder.client.get(`/api/v1/budgets/${id}/summary`).expect(404);
    await intruder.client.patch(`/api/v1/budgets/${id}`).send({ name: 'Mine' }).expect(404);
    await intruder.client.delete(`/api/v1/budgets/${id}`).expect(404);
    expect((await intruder.client.get('/api/v1/budgets').expect(200)).body.data.budgets).toEqual([]);
  });
});
