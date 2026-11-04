import request from 'supertest';
import { createApp } from '../src/app';
import { closeTestDatabase, connectTestDatabase } from './helpers/db';
import { balanceOf, categoryId, createAccount, financeSetup, isoDate } from './helpers/finance';

const app = createApp();

beforeAll(connectTestDatabase);
afterAll(closeTestDatabase);

describe('creating income and expenses (FR-021, FR-022, FR-026, FR-027)', () => {
  it('requires authentication', async () => {
    await request(app).get('/api/v1/transactions').expect(401);
  });

  it('records income with every captured field and increases the balance (AC-04)', async () => {
    const { client, account, categories } = await financeSetup(app);

    const res = await client
      .post('/api/v1/transactions')
      .send({
        type: 'INCOME',
        amountPaise: 8_000_000,
        date: isoDate(),
        title: 'November salary',
        accountId: account.id,
        categoryId: categories.salary,
        paymentMethod: 'NET_BANKING',
        notes: 'Includes bonus',
      })
      .expect(201);

    expect(res.body.data.transaction).toMatchObject({
      type: 'INCOME',
      amountPaise: 8_000_000,
      date: isoDate(),
      title: 'November salary',
      accountId: account.id,
      categoryId: categories.salary,
      paymentMethod: 'NET_BANKING',
      notes: 'Includes bonus',
      transferGroupId: null,
    });
    expect(await balanceOf(client, account.id)).toBe(1_000_000 + 8_000_000);
  });

  it('records an expense and decreases the balance (AC-05)', async () => {
    const { client, account, categories } = await financeSetup(app);
    await client
      .post('/api/v1/transactions')
      .send({
        type: 'EXPENSE',
        amountPaise: 250_050,
        date: isoDate(),
        title: 'Groceries',
        accountId: account.id,
        categoryId: categories.groceries,
      })
      .expect(201);
    expect(await balanceOf(client, account.id)).toBe(1_000_000 - 250_050);
  });

  it.each([
    [{ amountPaise: 0 }, 'amountPaise'],
    [{ amountPaise: 10.5 }, 'amountPaise'],
    [{ amountPaise: -100 }, 'amountPaise'],
    [{ date: '2026-02-30' }, 'date'],
    [{ date: '03/11/2026' }, 'date'],
    [{ title: '' }, 'title'],
    [{ type: 'TRANSFER_IN' }, 'type'],
    [{ paymentMethod: 'BITCOIN' }, 'paymentMethod'],
  ])('validates input %#', async (override, field) => {
    const { client, account, categories } = await financeSetup(app);
    const res = await client
      .post('/api/v1/transactions')
      .send({
        type: 'EXPENSE',
        amountPaise: 100,
        date: isoDate(),
        title: 'X',
        accountId: account.id,
        categoryId: categories.fuel,
        ...override,
      })
      .expect(400);
    expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: field })]));
  });

  it('rejects future dates', async () => {
    const { client, account, categories } = await financeSetup(app);
    const res = await client
      .post('/api/v1/transactions')
      .send({
        type: 'EXPENSE',
        amountPaise: 100,
        date: isoDate(3),
        title: 'X',
        accountId: account.id,
        categoryId: categories.fuel,
      })
      .expect(400);
    expect(res.body.error.details[0].path).toBe('date');
  });

  it('requires a category whose type matches and is not archived', async () => {
    const { client, account, categories } = await financeSetup(app);
    const base = { amountPaise: 100, date: isoDate(), title: 'X', accountId: account.id };

    const mismatch = await client
      .post('/api/v1/transactions')
      .send({ ...base, type: 'EXPENSE', categoryId: categories.salary })
      .expect(400);
    expect(mismatch.body.error.details[0].path).toBe('categoryId');

    await client.patch(`/api/v1/categories/${categories.fuel}`).send({ isArchived: true }).expect(200);
    await client
      .post('/api/v1/transactions')
      .send({ ...base, type: 'EXPENSE', categoryId: categories.fuel })
      .expect(400);
  });

  it('refuses new transactions on a deactivated account', async () => {
    const { client, account, categories } = await financeSetup(app);
    await client.delete(`/api/v1/accounts/${account.id}`).expect(200);
    const res = await client
      .post('/api/v1/transactions')
      .send({
        type: 'EXPENSE',
        amountPaise: 100,
        date: isoDate(),
        title: 'X',
        accountId: account.id,
        categoryId: categories.fuel,
      })
      .expect(400);
    expect(res.body.error.details[0].path).toBe('accountId');
  });
});

describe('editing and deleting (FR-031, AC-07)', () => {
  it('updates balances and summaries after an edit, a move between accounts, and a delete', async () => {
    const { client, account, categories } = await financeSetup(app);
    const other = await createAccount(client, { name: 'Wallet', accountType: 'WALLET' });
    const created = await client
      .post('/api/v1/transactions')
      .send({
        type: 'EXPENSE',
        amountPaise: 100_000,
        date: isoDate(),
        title: 'Fuel',
        accountId: account.id,
        categoryId: categories.fuel,
      })
      .expect(201);
    const id = created.body.data.transaction.id;

    await client.patch(`/api/v1/transactions/${id}`).send({ amountPaise: 150_000 }).expect(200);
    expect(await balanceOf(client, account.id)).toBe(1_000_000 - 150_000);

    await client.patch(`/api/v1/transactions/${id}`).send({ accountId: other.id }).expect(200);
    expect(await balanceOf(client, account.id)).toBe(1_000_000);
    expect(await balanceOf(client, other.id)).toBe(-150_000);

    const summary = await client.get('/api/v1/transactions/summary').expect(200);
    expect(summary.body.data.summaries[0]).toMatchObject({ expensePaise: 150_000, incomePaise: 0 });

    await client.delete(`/api/v1/transactions/${id}`).expect(200);
    expect(await balanceOf(client, other.id)).toBe(0);
    const after = await client.get('/api/v1/transactions/summary').expect(200);
    expect(after.body.data.summaries).toEqual([]);
    await client.get(`/api/v1/transactions/${id}`).expect(404);
  });

  it('switching type re-validates the category and clears optional fields with null', async () => {
    const { client, account, categories } = await financeSetup(app);
    const created = await client
      .post('/api/v1/transactions')
      .send({
        type: 'EXPENSE',
        amountPaise: 100,
        date: isoDate(),
        title: 'Refund?',
        accountId: account.id,
        categoryId: categories.fuel,
        notes: 'temp',
        paymentMethod: 'UPI',
      })
      .expect(201);
    const id = created.body.data.transaction.id;

    await client.patch(`/api/v1/transactions/${id}`).send({ type: 'INCOME' }).expect(400);
    const refunds = await categoryId(client, 'Refunds');
    const res = await client
      .patch(`/api/v1/transactions/${id}`)
      .send({ type: 'INCOME', categoryId: refunds, notes: null, paymentMethod: null })
      .expect(200);
    expect(res.body.data.transaction).toMatchObject({ type: 'INCOME', notes: null, paymentMethod: null });
  });
});

describe('listing, filtering, search and pagination (FR-023, FR-028, AC-10)', () => {
  async function seeded() {
    const ctx = await financeSetup(app);
    const wallet = await createAccount(ctx.client, { name: 'Wallet', accountType: 'WALLET' });
    const add = (body: Record<string, unknown>) =>
      ctx.client
        .post('/api/v1/transactions')
        .send({ accountId: ctx.account.id, ...body })
        .expect(201);

    await add({
      type: 'INCOME',
      amountPaise: 8_000_000,
      date: isoDate(-40),
      title: 'October salary',
      categoryId: ctx.categories.salary,
    });
    await add({
      type: 'EXPENSE',
      amountPaise: 2_000_000,
      date: isoDate(-10),
      title: 'Rent',
      categoryId: ctx.categories.rent,
      paymentMethod: 'NET_BANKING',
    });
    await add({
      type: 'EXPENSE',
      amountPaise: 300_000,
      date: isoDate(-5),
      title: 'Big Basket groceries',
      categoryId: ctx.categories.groceries,
      paymentMethod: 'UPI',
    });
    await add({
      type: 'EXPENSE',
      amountPaise: 150_000,
      date: isoDate(-1),
      title: 'Petrol',
      categoryId: ctx.categories.fuel,
      paymentMethod: 'UPI',
      accountId: wallet.id,
    });
    await add({
      type: 'INCOME',
      amountPaise: 1_000_000,
      date: isoDate(),
      title: 'Freelance (logo)',
      categoryId: await categoryId(ctx.client, 'Freelance'),
    });
    return { ...ctx, wallet };
  }

  it('returns newest first with page metadata', async () => {
    const { client } = await seeded();
    const res = await client.get('/api/v1/transactions?pageSize=2').expect(200);

    expect(res.body.data.transactions.map((t: { title: string }) => t.title)).toEqual(['Freelance (logo)', 'Petrol']);
    expect(res.body.meta).toEqual({ page: 1, pageSize: 2, total: 5, totalPages: 3 });

    const last = await client.get('/api/v1/transactions?pageSize=2&page=3').expect(200);
    expect(last.body.data.transactions.map((t: { title: string }) => t.title)).toEqual(['October salary']);
  });

  it('filters by an inclusive date range', async () => {
    const { client } = await seeded();
    const res = await client.get(`/api/v1/transactions?from=${isoDate(-10)}&to=${isoDate(-5)}`).expect(200);
    expect(res.body.data.transactions.map((t: { title: string }) => t.title)).toEqual(['Big Basket groceries', 'Rent']);
  });

  it('filters by type, account, category and payment method', async () => {
    const { client, wallet, categories } = await seeded();
    const titles = async (qs: string) =>
      (await client.get(`/api/v1/transactions?${qs}`).expect(200)).body.data.transactions.map(
        (t: { title: string }) => t.title,
      );

    expect(await titles('type=INCOME')).toEqual(['Freelance (logo)', 'October salary']);
    expect(await titles(`accountId=${wallet.id}`)).toEqual(['Petrol']);
    expect(await titles(`categoryId=${categories.rent}`)).toEqual(['Rent']);
    expect(await titles('paymentMethod=UPI')).toEqual(['Petrol', 'Big Basket groceries']);
    expect(await titles('minAmountPaise=1000000&maxAmountPaise=2000000')).toEqual(['Freelance (logo)', 'Rent']);
  });

  it('searches titles case-insensitively and treats regex characters literally', async () => {
    const { client } = await seeded();
    const search = async (q: string) =>
      (await client.get('/api/v1/transactions').query({ q }).expect(200)).body.data.transactions.map(
        (t: { title: string }) => t.title,
      );

    expect(await search('basket')).toEqual(['Big Basket groceries']);
    expect(await search('(logo)')).toEqual(['Freelance (logo)']);
    expect(await search('.*')).toEqual([]);
  });

  it('sorts by amount', async () => {
    const { client } = await seeded();
    const res = await client.get('/api/v1/transactions?sort=amount_asc&pageSize=1').expect(200);
    expect(res.body.data.transactions[0].title).toBe('Petrol');
  });

  it('summarises the same filtered set the list shows', async () => {
    const { client } = await seeded();
    const res = await client.get(`/api/v1/transactions/summary?from=${isoDate(-30)}`).expect(200);
    expect(res.body.data.summaries).toEqual([
      { currency: 'INR', incomePaise: 1_000_000, expensePaise: 2_450_000, netPaise: -1_450_000, transactionCount: 4 },
    ]);
  });

  it('rejects an inverted date range and oversized pages', async () => {
    const { client } = await seeded();
    await client.get(`/api/v1/transactions?from=${isoDate()}&to=${isoDate(-1)}`).expect(400);
    await client.get('/api/v1/transactions?pageSize=500').expect(400);
  });

  it('keeps currencies apart in the summary', async () => {
    const { client, categories } = await financeSetup(app);
    const usd = await createAccount(client, { name: 'US account', currency: 'USD' });
    await client
      .post('/api/v1/transactions')
      .send({
        type: 'INCOME',
        amountPaise: 10_000,
        date: isoDate(),
        title: 'USD gig',
        accountId: usd.id,
        categoryId: categories.salary,
      })
      .expect(201);
    const res = await client.get('/api/v1/transactions/summary').expect(200);
    expect(res.body.data.summaries).toEqual([expect.objectContaining({ currency: 'USD', incomePaise: 10_000 })]);
  });
});

describe('data isolation (AC-03)', () => {
  it("cannot read, edit or delete another user's transaction, or post into their account", async () => {
    const owner = await financeSetup(app);
    const intruder = await financeSetup(app);
    const created = await owner.client
      .post('/api/v1/transactions')
      .send({
        type: 'EXPENSE',
        amountPaise: 100,
        date: isoDate(),
        title: 'Private',
        accountId: owner.account.id,
        categoryId: owner.categories.fuel,
      })
      .expect(201);
    const id = created.body.data.transaction.id;

    await intruder.client.get(`/api/v1/transactions/${id}`).expect(404);
    await intruder.client.patch(`/api/v1/transactions/${id}`).send({ title: 'Hacked' }).expect(404);
    await intruder.client.delete(`/api/v1/transactions/${id}`).expect(404);
    expect((await intruder.client.get('/api/v1/transactions').expect(200)).body.meta.total).toBe(0);

    // Using the owner's account or category ids from the intruder's session.
    const base = { type: 'EXPENSE', amountPaise: 100, date: isoDate(), title: 'X' };
    await intruder.client
      .post('/api/v1/transactions')
      .send({ ...base, accountId: owner.account.id, categoryId: intruder.categories.fuel })
      .expect(404);
    await intruder.client
      .post('/api/v1/transactions')
      .send({ ...base, accountId: intruder.account.id, categoryId: owner.categories.fuel })
      .expect(404);

    expect((await owner.client.get(`/api/v1/transactions/${id}`).expect(200)).body.data.transaction.title).toBe(
      'Private',
    );
  });
});
