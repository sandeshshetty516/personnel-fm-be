import mongoose from 'mongoose';
import { createApp } from '../src/app';
import { TransactionModel } from '../src/modules/transactions/transaction.model';
import { closeTestDatabase, connectTestDatabase } from './helpers/db';
import { balanceOf, createAccount, financeSetup, isoDate } from './helpers/finance';

const app = createApp();

beforeAll(connectTestDatabase);
afterAll(closeTestDatabase);

async function setupTwoAccounts() {
  const ctx = await financeSetup(app, { name: 'Savings', openingBalancePaise: 5_000_000 });
  const cash = await createAccount(ctx.client, { name: 'Cash', accountType: 'CASH', openingBalancePaise: 100_000 });
  return { ...ctx, savings: ctx.account, cash };
}

describe('POST /accounts/transfer (FR-014 – FR-016, AC-06)', () => {
  it('moves money between accounts without changing income or expense totals', async () => {
    const { client, savings, cash, categories } = await setupTwoAccounts();
    await client
      .post('/api/v1/transactions')
      .send({
        type: 'INCOME',
        amountPaise: 8_000_000,
        date: isoDate(),
        title: 'Salary',
        accountId: savings.id,
        categoryId: categories.salary,
      })
      .expect(201);
    const before = (await client.get('/api/v1/transactions/summary').expect(200)).body.data.summaries;

    const res = await client
      .post('/api/v1/accounts/transfer')
      .send({ fromAccountId: savings.id, toAccountId: cash.id, amountPaise: 1_000_000, date: isoDate() })
      .expect(201);

    const { transfer } = res.body.data;
    expect(transfer.outgoing).toMatchObject({
      type: 'TRANSFER_OUT',
      accountId: savings.id,
      counterpartAccountId: cash.id,
      title: 'Savings → Cash',
    });
    expect(transfer.incoming).toMatchObject({
      type: 'TRANSFER_IN',
      accountId: cash.id,
      counterpartAccountId: savings.id,
    });
    expect(transfer.outgoing.transferGroupId).toBe(transfer.transferGroupId);

    expect(await balanceOf(client, savings.id)).toBe(5_000_000 + 8_000_000 - 1_000_000);
    expect(await balanceOf(client, cash.id)).toBe(100_000 + 1_000_000);

    const after = (await client.get('/api/v1/transactions/summary').expect(200)).body.data.summaries;
    expect(after).toEqual(before);
  });

  it('shows a transfer once in the overall list and once per account', async () => {
    const { client, savings, cash } = await setupTwoAccounts();
    await client
      .post('/api/v1/accounts/transfer')
      .send({ fromAccountId: savings.id, toAccountId: cash.id, amountPaise: 500, date: isoDate() })
      .expect(201);

    const all = await client.get('/api/v1/transactions').expect(200);
    expect(all.body.data.transactions).toHaveLength(1);
    expect(all.body.data.transactions[0]).toMatchObject({ type: 'TRANSFER_OUT', counterpartAccountId: cash.id });

    const cashOnly = await client.get(`/api/v1/transactions?accountId=${cash.id}`).expect(200);
    expect(cashOnly.body.data.transactions[0]).toMatchObject({ type: 'TRANSFER_IN', counterpartAccountId: savings.id });

    const transfers = await client.get('/api/v1/transactions?type=TRANSFER').expect(200);
    expect(transfers.body.meta.total).toBe(1);
  });

  it.each([
    ['the same account twice', (s: string) => ({ toAccountId: s }), 'toAccountId'],
    ['a zero amount', () => ({ amountPaise: 0 }), 'amountPaise'],
    ['a future date', () => ({ date: isoDate(5) }), 'date'],
  ])('rejects %s', async (_label, override, field) => {
    const { client, savings, cash } = await setupTwoAccounts();
    const res = await client
      .post('/api/v1/accounts/transfer')
      .send({
        fromAccountId: savings.id,
        toAccountId: cash.id,
        amountPaise: 100,
        date: isoDate(),
        ...override(savings.id),
      })
      .expect(400);
    expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: field })]));
  });

  it('rejects accounts in different currencies and deactivated accounts', async () => {
    const { client, savings, cash } = await setupTwoAccounts();
    const usd = await createAccount(client, { name: 'USD', currency: 'USD' });
    await client
      .post('/api/v1/accounts/transfer')
      .send({ fromAccountId: savings.id, toAccountId: usd.id, amountPaise: 100, date: isoDate() })
      .expect(400);

    await client.delete(`/api/v1/accounts/${cash.id}`).expect(200);
    await client
      .post('/api/v1/accounts/transfer')
      .send({ fromAccountId: savings.id, toAccountId: cash.id, amountPaise: 100, date: isoDate() })
      .expect(400);
  });

  it("cannot transfer to or from another user's account", async () => {
    const { client, savings } = await setupTwoAccounts();
    const other = await setupTwoAccounts();
    await client
      .post('/api/v1/accounts/transfer')
      .send({ fromAccountId: savings.id, toAccountId: other.cash.id, amountPaise: 100, date: isoDate() })
      .expect(404);
    await client
      .post('/api/v1/accounts/transfer')
      .send({ fromAccountId: other.savings.id, toAccountId: savings.id, amountPaise: 100, date: isoDate() })
      .expect(404);
    expect(await balanceOf(other.client, other.cash.id)).toBe(100_000);
  });

  it('writes neither leg if the database write fails part-way (atomicity)', async () => {
    const { client, user, savings, cash } = await setupTwoAccounts();
    // Fail every attempt (the driver may retry the transaction); nothing may be left behind.
    const spy = jest.spyOn(TransactionModel, 'create').mockImplementation(async (docs, options) => {
      await mongoose.connection
        .collection('transactions')
        .insertOne(
          { ...(docs as unknown as Record<string, unknown>[])[0], createdAt: new Date(), updatedAt: new Date() },
          { session: (options as { session: mongoose.ClientSession }).session },
        );
      throw new Error('Simulated crash after the first leg');
    });

    await client
      .post('/api/v1/accounts/transfer')
      .send({ fromAccountId: savings.id, toAccountId: cash.id, amountPaise: 100, date: isoDate() })
      .expect(500);
    spy.mockRestore();

    expect(await TransactionModel.countDocuments({ userId: user.id })).toBe(0);
    expect(await balanceOf(client, savings.id)).toBe(5_000_000);
  });
});

describe('editing and deleting transfers (FR-015)', () => {
  async function withTransfer() {
    const ctx = await setupTwoAccounts();
    const res = await ctx.client
      .post('/api/v1/accounts/transfer')
      .send({ fromAccountId: ctx.savings.id, toAccountId: ctx.cash.id, amountPaise: 1_000_000, date: isoDate() })
      .expect(201);
    return { ...ctx, transfer: res.body.data.transfer };
  }

  it('updates both legs together', async () => {
    const { client, savings, cash, transfer } = await withTransfer();
    const res = await client
      .patch(`/api/v1/transactions/${transfer.incoming.id}`)
      .send({ amountPaise: 400_000, title: 'ATM withdrawal', notes: 'Weekend' })
      .expect(200);
    expect(res.body.data.transaction).toMatchObject({
      amountPaise: 400_000,
      title: 'ATM withdrawal',
      notes: 'Weekend',
    });

    expect(await balanceOf(client, savings.id)).toBe(5_000_000 - 400_000);
    expect(await balanceOf(client, cash.id)).toBe(100_000 + 400_000);
    const out = await client.get(`/api/v1/transactions/${transfer.outgoing.id}`).expect(200);
    expect(out.body.data.transaction).toMatchObject({ amountPaise: 400_000, title: 'ATM withdrawal' });
  });

  it('refuses to change accounts, type or category of a transfer', async () => {
    const { client, cash, transfer, categories } = await withTransfer();
    await client.patch(`/api/v1/transactions/${transfer.outgoing.id}`).send({ accountId: cash.id }).expect(400);
    await client.patch(`/api/v1/transactions/${transfer.outgoing.id}`).send({ type: 'EXPENSE' }).expect(400);
    await client
      .patch(`/api/v1/transactions/${transfer.outgoing.id}`)
      .send({ categoryId: categories.fuel })
      .expect(400);
  });

  it('deleting one leg deletes both and restores balances', async () => {
    const { client, savings, cash, transfer } = await withTransfer();
    const res = await client.delete(`/api/v1/transactions/${transfer.outgoing.id}`).expect(200);
    expect(res.body.data).toEqual({ deletedCount: 2 });

    await client.get(`/api/v1/transactions/${transfer.incoming.id}`).expect(404);
    expect(await balanceOf(client, savings.id)).toBe(5_000_000);
    expect(await balanceOf(client, cash.id)).toBe(100_000);
  });
});
