import request from 'supertest';
import { createApp } from '../src/app';
import { registerClient } from './helpers/auth';
import { closeTestDatabase, connectTestDatabase } from './helpers/db';
import { balanceOf, createAccount, financeSetup, isoDate } from './helpers/finance';

const app = createApp();

beforeAll(connectTestDatabase);
afterAll(closeTestDatabase);

type Agent = Awaited<ReturnType<typeof financeSetup>>['client'];

async function setup() {
  const ctx = await financeSetup(app);
  const account = await createAccount(ctx.client, { openingBalancePaise: 10_000_000 });
  return { ...ctx, account };
}

async function createDebt(client: Agent, overrides: Record<string, unknown> = {}) {
  const res = await client
    .post('/api/v1/debts')
    .send({ direction: 'LENT', personName: 'Ravi', amountPaise: 500_000, date: isoDate(-5), ...overrides })
    .expect(201);
  return res.body.data as { debt: { id: string; [key: string]: unknown }; entry: { id: string; transactionId: string | null } };
}

async function addEntry(client: Agent, debtId: string, body: Record<string, unknown>, status = 201) {
  return client
    .post(`/api/v1/debts/${debtId}/entries`)
    .send({ date: isoDate(), ...body })
    .expect(status);
}

async function cashFlow(client: Agent) {
  const res = await client.get('/api/v1/dashboard/summary').expect(200);
  const { incomePaise, expensePaise, netPaise } = res.body.data;
  return { incomePaise, expensePaise, netPaise };
}

describe('lending and borrowing (FR-075, FR-077, FR-078, AC-13)', () => {
  it('requires authentication', async () => {
    await request(app).get('/api/v1/debts').expect(401);
  });

  it('lending from an account lowers its balance without touching income or expense', async () => {
    const { client, account } = await setup();
    const before = await cashFlow(client);

    const { debt, entry } = await createDebt(client, { accountId: account.id, dueDate: '2099-01-01' });

    expect(debt).toMatchObject({
      direction: 'LENT',
      personName: 'Ravi',
      currency: 'INR',
      principalPaise: 500_000,
      outstandingPaise: 500_000,
      status: 'OPEN',
      isOverdue: false,
      dueDate: '2099-01-01',
    });
    expect(await balanceOf(client, account.id)).toBe(10_000_000 - 500_000);
    expect(await cashFlow(client)).toEqual(before);

    const tx = await client.get(`/api/v1/transactions/${entry.transactionId}`).expect(200);
    expect(tx.body.data.transaction).toMatchObject({
      type: 'DEBT_OUT',
      title: 'Lent to Ravi',
      debtId: debt.id,
      affectsBalance: true,
    });
  });

  it('borrowing into an account raises its balance', async () => {
    const { client, account } = await setup();
    const { entry } = await createDebt(client, { direction: 'BORROWED', personName: 'Meena', accountId: account.id });
    expect(await balanceOf(client, account.id)).toBe(10_000_000 + 500_000);
    const tx = await client.get(`/api/v1/transactions/${entry.transactionId}`).expect(200);
    expect(tx.body.data.transaction).toMatchObject({ type: 'DEBT_IN', title: 'Borrowed from Meena' });
  });

  it('an entry without an account only changes the outstanding amount', async () => {
    const { client, account } = await setup();
    const { debt, entry } = await createDebt(client);
    expect(entry.transactionId).toBeNull();
    expect(debt.outstandingPaise).toBe(500_000);
    expect(await balanceOf(client, account.id)).toBe(10_000_000);
  });

  it.each([
    [{ personName: '' }, 'personName'],
    [{ amountPaise: 0 }, 'amountPaise'],
    [{ direction: 'GIFTED' }, 'direction'],
    [{ date: isoDate(1) }, 'date'],
    [{ dueDate: isoDate(-10) }, 'dueDate'],
  ])('validates input %#', async (override, field) => {
    const { client } = await setup();
    const res = await client
      .post('/api/v1/debts')
      .send({ direction: 'LENT', personName: 'Ravi', amountPaise: 100, date: isoDate(-5), ...override })
      .expect(400);
    expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: field })]));
  });

  it('lists debt transactions under the DEBT filter', async () => {
    const { client, account } = await setup();
    await createDebt(client, { accountId: account.id });
    const res = await client.get('/api/v1/transactions?type=DEBT').expect(200);
    expect(res.body.data.transactions).toHaveLength(1);
    expect(res.body.data.transactions[0].type).toBe('DEBT_OUT');
  });
});

describe('repayments (FR-076, FR-080, AC-14)', () => {
  it('partial then full repayment settles the record and returns the money', async () => {
    const { client, account } = await setup();
    const { debt } = await createDebt(client, { accountId: account.id });

    const partial = await addEntry(client, debt.id, { type: 'REPAYMENT', amountPaise: 200_000, accountId: account.id });
    expect(partial.body.data.debt).toMatchObject({ repaidPaise: 200_000, outstandingPaise: 300_000, status: 'OPEN' });
    expect(partial.body.data.debt.progressPercent).toBe(40);

    const full = await addEntry(client, debt.id, { type: 'REPAYMENT', amountPaise: 300_000, accountId: account.id });
    expect(full.body.data.debt).toMatchObject({ outstandingPaise: 0, status: 'SETTLED' });
    expect(full.body.data.debt.closedAt).not.toBeNull();
    expect(await balanceOf(client, account.id)).toBe(10_000_000);

    const tx = await client.get(`/api/v1/transactions/${full.body.data.entry.transactionId}`).expect(200);
    expect(tx.body.data.transaction).toMatchObject({ type: 'DEBT_IN', title: 'Repayment from Ravi' });
  });

  it('repaying a borrowed amount takes money out of the account', async () => {
    const { client, account } = await setup();
    const { debt } = await createDebt(client, { direction: 'BORROWED', accountId: account.id });
    await addEntry(client, debt.id, { type: 'REPAYMENT', amountPaise: 500_000, accountId: account.id });
    expect(await balanceOf(client, account.id)).toBe(10_000_000);
  });

  it('rejects a repayment larger than the outstanding amount and writes nothing', async () => {
    const { client, account } = await setup();
    const { debt } = await createDebt(client, { accountId: account.id });
    const res = await addEntry(client, debt.id, { type: 'REPAYMENT', amountPaise: 500_001, accountId: account.id }, 400);
    expect(res.body.error.details).toEqual([expect.objectContaining({ path: 'amountPaise' })]);

    const entries = await client.get(`/api/v1/debts/${debt.id}/entries`).expect(200);
    expect(entries.body.data.entries).toHaveLength(1);
    expect(await balanceOf(client, account.id)).toBe(10_000_000 - 500_000);
  });

  it('lending a further amount reopens a settled record', async () => {
    const { client } = await setup();
    const { debt } = await createDebt(client);
    await addEntry(client, debt.id, { type: 'REPAYMENT', amountPaise: 500_000 });
    const res = await addEntry(client, debt.id, { type: 'PRINCIPAL', amountPaise: 100_000 });
    expect(res.body.data.debt).toMatchObject({ principalPaise: 600_000, outstandingPaise: 100_000, status: 'OPEN' });
    expect(res.body.data.debt.closedAt).toBeNull();
  });

  it('rejects entries dated before the record or in the future', async () => {
    const { client } = await setup();
    const { debt } = await createDebt(client);
    await addEntry(client, debt.id, { type: 'REPAYMENT', amountPaise: 1, date: isoDate(-6) }, 400);
    await addEntry(client, debt.id, { type: 'REPAYMENT', amountPaise: 1, date: isoDate(1) }, 400);
  });

  it('refuses an account in another currency', async () => {
    const { client } = await setup();
    const usd = await createAccount(client, { currency: 'USD' });
    const { debt } = await createDebt(client);
    const res = await addEntry(client, debt.id, { type: 'REPAYMENT', amountPaise: 100, accountId: usd.id }, 400);
    expect(res.body.error.details).toEqual([expect.objectContaining({ path: 'accountId' })]);
  });
});

describe('write-offs (FR-079, AC-15)', () => {
  it('books a Bad Debt expense, closes the record and leaves the balance alone', async () => {
    const { client, account } = await setup();
    const { debt } = await createDebt(client, { accountId: account.id });
    await addEntry(client, debt.id, { type: 'REPAYMENT', amountPaise: 100_000, accountId: account.id });
    const before = await cashFlow(client);
    const balanceBefore = await balanceOf(client, account.id);

    // No accountId: reported under the account the money was lent from.
    const res = await addEntry(client, debt.id, { type: 'WRITE_OFF', amountPaise: 400_000 });
    expect(res.body.data.debt).toMatchObject({ writtenOffPaise: 400_000, outstandingPaise: 0, status: 'WRITTEN_OFF' });
    expect(res.body.data.entry.accountId).toBe(account.id);

    expect(await balanceOf(client, account.id)).toBe(balanceBefore);
    expect(await cashFlow(client)).toEqual({
      incomePaise: before.incomePaise,
      expensePaise: before.expensePaise + 400_000,
      netPaise: before.netPaise - 400_000,
    });

    const tx = await client.get(`/api/v1/transactions/${res.body.data.entry.transactionId}`).expect(200);
    expect(tx.body.data.transaction).toMatchObject({ type: 'EXPENSE', title: 'Bad debt: Ravi', affectsBalance: false });
    const categories = await client.get('/api/v1/categories').expect(200);
    const badDebt = (categories.body.data.categories as { id: string; name: string }[]).find((c) => c.name === 'Bad Debt');
    expect(tx.body.data.transaction.categoryId).toBe(badDebt?.id);
  });

  it('reuses the Bad Debt category on later write-offs', async () => {
    const { client, account } = await setup();
    for (const name of ['A', 'B']) {
      const { debt } = await createDebt(client, { personName: name, accountId: account.id });
      await addEntry(client, debt.id, { type: 'WRITE_OFF', amountPaise: 500_000 });
    }
    const categories = await client.get('/api/v1/categories').expect(200);
    const names = (categories.body.data.categories as { name: string }[]).filter((c) => c.name === 'Bad Debt');
    expect(names).toHaveLength(1);
  });

  it('only applies to money lent', async () => {
    const { client, account } = await setup();
    const { debt } = await createDebt(client, { direction: 'BORROWED', accountId: account.id });
    const res = await addEntry(client, debt.id, { type: 'WRITE_OFF', amountPaise: 100, accountId: account.id }, 400);
    expect(res.body.error.details).toEqual([expect.objectContaining({ path: 'type' })]);
  });

  it('needs an account when nothing was lent from one', async () => {
    const { client } = await setup();
    const { debt } = await createDebt(client);
    const res = await addEntry(client, debt.id, { type: 'WRITE_OFF', amountPaise: 100 }, 400);
    expect(res.body.error.details).toEqual([expect.objectContaining({ path: 'accountId' })]);
  });
});

describe('deleting (AC-14)', () => {
  it('deleting a repayment reverses the balance and reopens the record', async () => {
    const { client, account } = await setup();
    const { debt } = await createDebt(client, { accountId: account.id });
    const repaid = await addEntry(client, debt.id, { type: 'REPAYMENT', amountPaise: 500_000, accountId: account.id });

    const res = await client.delete(`/api/v1/debts/${debt.id}/entries/${repaid.body.data.entry.id}`).expect(200);
    expect(res.body.data.debt).toMatchObject({ repaidPaise: 0, outstandingPaise: 500_000, status: 'OPEN' });
    expect(await balanceOf(client, account.id)).toBe(10_000_000 - 500_000);
    await client.get(`/api/v1/transactions/${repaid.body.data.entry.transactionId}`).expect(404);
  });

  it('will not remove a lent amount that repayments depend on', async () => {
    const { client } = await setup();
    const { debt, entry } = await createDebt(client);
    await addEntry(client, debt.id, { type: 'REPAYMENT', amountPaise: 100 });
    await client.delete(`/api/v1/debts/${debt.id}/entries/${entry.id}`).expect(400);
  });

  it('deleting the record removes its transactions and restores the balance', async () => {
    const { client, account } = await setup();
    const { debt } = await createDebt(client, { accountId: account.id });
    await addEntry(client, debt.id, { type: 'REPAYMENT', amountPaise: 200_000, accountId: account.id });

    const res = await client.delete(`/api/v1/debts/${debt.id}`).expect(200);
    expect(res.body.data.deletedTransactionCount).toBe(2);
    expect(await balanceOf(client, account.id)).toBe(10_000_000);
    await client.get(`/api/v1/debts/${debt.id}`).expect(404);
  });

  it('debt transactions cannot be edited or deleted through /transactions', async () => {
    const { client, account } = await setup();
    const { entry } = await createDebt(client, { accountId: account.id });
    await client.patch(`/api/v1/transactions/${entry.transactionId}`).send({ title: 'Changed' }).expect(400);
    await client.delete(`/api/v1/transactions/${entry.transactionId}`).expect(400);
  });
});

describe('editing, listing and summary (FR-081)', () => {
  it('edits the person, phone, due date and notes', async () => {
    const { client } = await setup();
    const { debt } = await createDebt(client, { phone: '98450 00000' });
    const res = await client
      .patch(`/api/v1/debts/${debt.id}`)
      .send({ personName: 'Ravi K', phone: null, dueDate: isoDate(-1), notes: 'Pay by month end' })
      .expect(200);
    expect(res.body.data.debt).toMatchObject({
      personName: 'Ravi K',
      phone: null,
      notes: 'Pay by month end',
      isOverdue: true,
    });
  });

  it('filters by direction and status', async () => {
    const { client } = await setup();
    await createDebt(client);
    const borrowed = await createDebt(client, { direction: 'BORROWED' });
    await addEntry(client, borrowed.debt.id, { type: 'REPAYMENT', amountPaise: 500_000 });

    const lent = await client.get('/api/v1/debts?direction=LENT').expect(200);
    expect(lent.body.data.debts).toHaveLength(1);
    const settled = await client.get('/api/v1/debts?status=SETTLED').expect(200);
    expect(settled.body.data.debts.map((d: { id: string }) => d.id)).toEqual([borrowed.debt.id]);
  });

  it('summarises open amounts and groups people by name, ignoring case', async () => {
    const { client } = await setup();
    await createDebt(client, { personName: 'Ravi', amountPaise: 300_000 });
    await createDebt(client, { personName: 'ravi', amountPaise: 200_000, dueDate: isoDate(-1) });
    await createDebt(client, { personName: 'Ravi', direction: 'BORROWED', amountPaise: 100_000 });
    await createDebt(client, { personName: 'Meena', direction: 'BORROWED', amountPaise: 50_000 });
    const settled = await createDebt(client, { personName: 'Old', amountPaise: 1_000 });
    await addEntry(client, settled.debt.id, { type: 'REPAYMENT', amountPaise: 1_000 });

    const res = await client.get('/api/v1/debts/summary').expect(200);
    expect(res.body.data.summaries).toEqual([
      {
        currency: 'INR',
        receivablePaise: 500_000,
        payablePaise: 150_000,
        openLentCount: 2,
        openBorrowedCount: 2,
        overdueCount: 1,
        people: [
          { personName: 'Meena', receivablePaise: 0, payablePaise: 50_000, netPaise: -50_000 },
          { personName: 'Ravi', receivablePaise: 500_000, payablePaise: 100_000, netPaise: 400_000 },
        ],
      },
    ]);
  });

  it("never exposes another user's records", async () => {
    const { client } = await setup();
    const { debt } = await createDebt(client);
    const other = await registerClient(app);
    await other.client.get(`/api/v1/debts/${debt.id}`).expect(404);
    await other.client.post(`/api/v1/debts/${debt.id}/entries`).send({ type: 'REPAYMENT', amountPaise: 1, date: isoDate() }).expect(404);
    await other.client.delete(`/api/v1/debts/${debt.id}`).expect(404);
    const list = await other.client.get('/api/v1/debts').expect(200);
    expect(list.body.data.debts).toEqual([]);
    const summary = await other.client.get('/api/v1/debts/summary').expect(200);
    expect(summary.body.data.summaries).toEqual([]);
  });
});
