import request from 'supertest';
import { createApp } from '../src/app';
import { closeTestDatabase, connectTestDatabase } from './helpers/db';
import { balanceOf, financeSetup, isoDate } from './helpers/finance';

const app = createApp();

beforeAll(connectTestDatabase);
afterAll(closeTestDatabase);

async function withGoal(overrides: Record<string, unknown> = {}) {
  const ctx = await financeSetup(app);
  const res = await ctx.client
    .post('/api/v1/savings-goals')
    .send({ name: 'Emergency fund', targetAmountPaise: 10_000_000, ...overrides })
    .expect(201);
  return { ...ctx, goal: res.body.data.goal as { id: string } };
}

describe('savings goals (FR-038, FR-040)', () => {
  it('requires authentication', async () => {
    await request(app).get('/api/v1/savings-goals').expect(401);
  });

  it('creates a goal with an optional target date', async () => {
    const { client } = await financeSetup(app);
    const res = await client
      .post('/api/v1/savings-goals')
      .send({ name: 'New laptop', targetAmountPaise: 15_000_000, targetDate: '2099-12-31' })
      .expect(201);
    expect(res.body.data.goal).toMatchObject({
      name: 'New laptop',
      currency: 'INR',
      status: 'ACTIVE',
      savedPaise: 0,
      remainingPaise: 15_000_000,
      progressPercent: 0,
      isTargetReached: false,
      targetDate: '2099-12-31',
    });
    expect(res.body.data.goal.monthlyNeededPaise).toBeGreaterThan(0);
  });

  it.each([
    [{ name: '' }, 'name'],
    [{ targetAmountPaise: 0 }, 'targetAmountPaise'],
    [{ targetDate: 'soon' }, 'targetDate'],
  ])('validates input %#', async (override, field) => {
    const { client } = await financeSetup(app);
    const res = await client
      .post('/api/v1/savings-goals')
      .send({ name: 'Goal', targetAmountPaise: 100, ...override })
      .expect(400);
    expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: field })]));
  });
});

describe('contributions and withdrawals (FR-039, FR-041, AC-09)', () => {
  it('tracks saved, remaining and progress, capping progress at 100%', async () => {
    const { client, goal } = await withGoal();

    let res = await client
      .post(`/api/v1/savings-goals/${goal.id}/contributions`)
      .send({ amountPaise: 2_500_000, date: isoDate(), notes: 'First deposit' })
      .expect(201);
    expect(res.body.data.goal).toMatchObject({ savedPaise: 2_500_000, remainingPaise: 7_500_000, progressPercent: 25 });
    expect(res.body.data.contribution).toMatchObject({
      type: 'CONTRIBUTION',
      amountPaise: 2_500_000,
      notes: 'First deposit',
    });

    res = await client
      .post(`/api/v1/savings-goals/${goal.id}/contributions`)
      .send({ type: 'WITHDRAWAL', amountPaise: 500_000, date: isoDate() })
      .expect(201);
    expect(res.body.data.goal).toMatchObject({ savedPaise: 2_000_000, progressPercent: 20 });

    res = await client
      .post(`/api/v1/savings-goals/${goal.id}/contributions`)
      .send({ amountPaise: 9_000_000, date: isoDate() })
      .expect(201);
    expect(res.body.data.goal).toMatchObject({
      savedPaise: 11_000_000,
      remainingPaise: 0,
      progressPercent: 100,
      isTargetReached: true,
    });

    const history = await client.get(`/api/v1/savings-goals/${goal.id}/history`).expect(200);
    expect(
      history.body.data.contributions.map((c: { type: string; amountPaise: number }) => [c.type, c.amountPaise]),
    ).toEqual(
      expect.arrayContaining([
        ['CONTRIBUTION', 2_500_000],
        ['WITHDRAWAL', 500_000],
        ['CONTRIBUTION', 9_000_000],
      ]),
    );
  });

  it('never withdraws more than has been saved, even concurrently', async () => {
    const { client, goal } = await withGoal();
    await client
      .post(`/api/v1/savings-goals/${goal.id}/contributions`)
      .send({ amountPaise: 1_000, date: isoDate() })
      .expect(201);

    const results = await Promise.all(
      [1, 2, 3].map(() =>
        client
          .post(`/api/v1/savings-goals/${goal.id}/contributions`)
          .send({ type: 'WITHDRAWAL', amountPaise: 600, date: isoDate() }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const after = await client.get(`/api/v1/savings-goals/${goal.id}`).expect(200);
    expect(after.body.data.goal.savedPaise).toBe(400);
  });

  it('never counts contributions as expenses or changes account balances (FR-042)', async () => {
    const { client, goal, account } = await withGoal();
    const before = await client.get('/api/v1/dashboard/summary').expect(200);

    await client
      .post(`/api/v1/savings-goals/${goal.id}/contributions`)
      .send({ amountPaise: 500_000, date: isoDate(), accountId: account.id })
      .expect(201);

    const after = await client.get('/api/v1/dashboard/summary').expect(200);
    expect(after.body.data.expensePaise).toBe(before.body.data.expensePaise);
    expect(await balanceOf(client, account.id)).toBe(1_000_000);
  });

  it('removes a mistaken entry but refuses one that would go negative', async () => {
    const { client, goal } = await withGoal();
    const deposit = await client
      .post(`/api/v1/savings-goals/${goal.id}/contributions`)
      .send({ amountPaise: 1_000, date: isoDate() })
      .expect(201);
    await client
      .post(`/api/v1/savings-goals/${goal.id}/contributions`)
      .send({ type: 'WITHDRAWAL', amountPaise: 800, date: isoDate() })
      .expect(201);

    await client
      .delete(`/api/v1/savings-goals/${goal.id}/contributions/${deposit.body.data.contribution.id}`)
      .expect(400);
  });

  it('only accepts money on active goals, and allows completing and archiving (FR-041)', async () => {
    const { client, goal } = await withGoal();
    const completed = await client.patch(`/api/v1/savings-goals/${goal.id}`).send({ status: 'COMPLETED' }).expect(200);
    expect(completed.body.data.goal.completedAt).not.toBeNull();

    await client
      .post(`/api/v1/savings-goals/${goal.id}/contributions`)
      .send({ amountPaise: 100, date: isoDate() })
      .expect(400);

    await client.patch(`/api/v1/savings-goals/${goal.id}`).send({ status: 'ARCHIVED' }).expect(200);
    const archived = await client.get('/api/v1/savings-goals?status=ARCHIVED').expect(200);
    expect(archived.body.data.goals).toHaveLength(1);
    expect((await client.get('/api/v1/savings-goals?status=ACTIVE').expect(200)).body.data.goals).toHaveLength(0);
  });

  it('rejects future dates and accounts the user does not own', async () => {
    const { client, goal } = await withGoal();
    const other = await financeSetup(app);
    await client
      .post(`/api/v1/savings-goals/${goal.id}/contributions`)
      .send({ amountPaise: 100, date: isoDate(5) })
      .expect(400);
    await client
      .post(`/api/v1/savings-goals/${goal.id}/contributions`)
      .send({ amountPaise: 100, date: isoDate(), accountId: other.account.id })
      .expect(404);
  });
});

describe('data isolation (AC-03)', () => {
  it("cannot see or touch another user's goal", async () => {
    const owner = await withGoal();
    const intruder = await financeSetup(app);
    const id = owner.goal.id;

    await intruder.client.get(`/api/v1/savings-goals/${id}`).expect(404);
    await intruder.client.patch(`/api/v1/savings-goals/${id}`).send({ name: 'Mine' }).expect(404);
    await intruder.client
      .post(`/api/v1/savings-goals/${id}/contributions`)
      .send({ amountPaise: 1, date: isoDate() })
      .expect(404);
    await intruder.client.get(`/api/v1/savings-goals/${id}/history`).expect(404);
    expect((await intruder.client.get('/api/v1/savings-goals').expect(200)).body.data.goals).toEqual([]);
  });
});
