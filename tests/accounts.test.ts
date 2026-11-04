import request from 'supertest';
import { createApp } from '../src/app';
import { registerClient } from './helpers/auth';
import { closeTestDatabase, connectTestDatabase } from './helpers/db';
import { insertTransaction } from './helpers/fixtures';

const app = createApp();

beforeAll(connectTestDatabase);
afterAll(closeTestDatabase);

const savings = { name: 'HDFC Savings', accountType: 'SAVINGS', openingBalancePaise: 5_000_000 };

describe('accounts CRUD (FR-010 – FR-012)', () => {
  it('requires authentication', async () => {
    await request(app).get('/api/v1/accounts').expect(401);
  });

  it('creates an account defaulting to the user currency and lists it with its balance', async () => {
    const { client } = await registerClient(app);

    const created = await client
      .post('/api/v1/accounts')
      .send({ ...savings, institution: 'HDFC Bank', lastFourDigits: '4321' })
      .expect(201);
    expect(created.body.data.account).toMatchObject({
      name: 'HDFC Savings',
      accountType: 'SAVINGS',
      currency: 'INR',
      openingBalancePaise: 5_000_000,
      currentBalancePaise: 5_000_000,
      institution: 'HDFC Bank',
      lastFourDigits: '4321',
      isActive: true,
    });

    const list = await client.get('/api/v1/accounts').expect(200);
    expect(list.body.data.accounts).toHaveLength(1);
  });

  it.each(['SAVINGS', 'CURRENT', 'CASH', 'CREDIT_CARD', 'WALLET'])('supports the %s account type', async (type) => {
    const { client } = await registerClient(app);
    await client
      .post('/api/v1/accounts')
      .send({ name: `My ${type}`, accountType: type })
      .expect(201);
  });

  it.each([
    [{ name: '', accountType: 'SAVINGS' }, 'name'],
    [{ name: 'X', accountType: 'LOCKER' }, 'accountType'],
    [{ name: 'X', accountType: 'CASH', openingBalancePaise: 10.5 }, 'openingBalancePaise'],
    [{ name: 'X', accountType: 'CASH', lastFourDigits: '12' }, 'lastFourDigits'],
  ])('validates input %#', async (payload, field) => {
    const { client } = await registerClient(app);
    const res = await client.post('/api/v1/accounts').send(payload).expect(400);
    expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: field })]));
  });

  it('rejects a duplicate name for the same user, ignoring case', async () => {
    const { client } = await registerClient(app);
    await client.post('/api/v1/accounts').send(savings).expect(201);
    await client
      .post('/api/v1/accounts')
      .send({ ...savings, name: 'hdfc savings' })
      .expect(409);
  });

  it('allows the same account name for different users', async () => {
    const a = await registerClient(app);
    const b = await registerClient(app);
    await a.client.post('/api/v1/accounts').send(savings).expect(201);
    await b.client.post('/api/v1/accounts').send(savings).expect(201);
  });

  it('updates fields and clears optional ones with null', async () => {
    const { client } = await registerClient(app);
    const { body } = await client
      .post('/api/v1/accounts')
      .send({ ...savings, institution: 'HDFC' })
      .expect(201);

    const res = await client
      .patch(`/api/v1/accounts/${body.data.account.id}`)
      .send({ name: 'Salary Account', institution: null, openingBalancePaise: 100 })
      .expect(200);
    expect(res.body.data.account).toMatchObject({
      name: 'Salary Account',
      institution: null,
      currentBalancePaise: 100,
    });
  });

  it('deactivates instead of deleting, hides inactive accounts by default, and can reactivate', async () => {
    const { client } = await registerClient(app);
    const { body } = await client.post('/api/v1/accounts').send(savings).expect(201);
    const id = body.data.account.id;

    const res = await client.delete(`/api/v1/accounts/${id}`).expect(200);
    expect(res.body.data.account.isActive).toBe(false);

    expect((await client.get('/api/v1/accounts').expect(200)).body.data.accounts).toHaveLength(0);
    expect((await client.get('/api/v1/accounts?includeInactive=true').expect(200)).body.data.accounts).toHaveLength(1);

    await client.patch(`/api/v1/accounts/${id}`).send({ isActive: true }).expect(200);
    expect((await client.get('/api/v1/accounts').expect(200)).body.data.accounts).toHaveLength(1);
  });

  it('rejects malformed ids with 400', async () => {
    const { client } = await registerClient(app);
    await client.get('/api/v1/accounts/not-an-id').expect(400);
  });
});

describe('account balance (FR-013, business rules §6)', () => {
  it('is opening balance + credits − debits, including transfers', async () => {
    const { client, user } = await registerClient(app);
    const { body } = await client.post('/api/v1/accounts').send(savings).expect(201);
    const accountId = body.data.account.id;

    await insertTransaction({ userId: user.id, accountId, type: 'INCOME', amountPaise: 8_000_000 });
    await insertTransaction({ userId: user.id, accountId, type: 'EXPENSE', amountPaise: 2_500_050 });
    await insertTransaction({ userId: user.id, accountId, type: 'TRANSFER_OUT', amountPaise: 1_000_000 });
    await insertTransaction({ userId: user.id, accountId, type: 'TRANSFER_IN', amountPaise: 10 });

    const res = await client.get(`/api/v1/accounts/${accountId}`).expect(200);
    // 50,000.00 + 80,000.00 − 25,000.50 − 10,000.00 + 0.10
    expect(res.body.data.account.currentBalancePaise).toBe(9_499_960);
  });

  it('supports negative balances such as credit-card dues', async () => {
    const { client, user } = await registerClient(app);
    const { body } = await client
      .post('/api/v1/accounts')
      .send({ name: 'Visa', accountType: 'CREDIT_CARD', openingBalancePaise: -1_200_000 })
      .expect(201);
    await insertTransaction({
      userId: user.id,
      accountId: body.data.account.id,
      type: 'EXPENSE',
      amountPaise: 300_000,
    });

    const list = await client.get('/api/v1/accounts').expect(200);
    expect(list.body.data.accounts[0].currentBalancePaise).toBe(-1_500_000);
  });

  it("ignores another user's transactions", async () => {
    const owner = await registerClient(app);
    const other = await registerClient(app);
    const { body } = await owner.client.post('/api/v1/accounts').send(savings).expect(201);
    const accountId = body.data.account.id;

    // A forged row claiming the owner's account but belonging to someone else must not count.
    await insertTransaction({ userId: other.user.id, accountId, type: 'INCOME', amountPaise: 999 });

    const res = await owner.client.get(`/api/v1/accounts/${accountId}`).expect(200);
    expect(res.body.data.account.currentBalancePaise).toBe(5_000_000);
  });
});

describe('data isolation (AC-03)', () => {
  it("returns 404 for another user's account on read, update and deactivate", async () => {
    const owner = await registerClient(app);
    const intruder = await registerClient(app);
    const { body } = await owner.client.post('/api/v1/accounts').send(savings).expect(201);
    const id = body.data.account.id;

    await intruder.client.get(`/api/v1/accounts/${id}`).expect(404);
    await intruder.client.patch(`/api/v1/accounts/${id}`).send({ name: 'Mine now' }).expect(404);
    await intruder.client.delete(`/api/v1/accounts/${id}`).expect(404);
    expect((await intruder.client.get('/api/v1/accounts').expect(200)).body.data.accounts).toHaveLength(0);

    const unchanged = await owner.client.get(`/api/v1/accounts/${id}`).expect(200);
    expect(unchanged.body.data.account).toMatchObject({ name: 'HDFC Savings', isActive: true });
  });

  it('does not accept a userId in the request body', async () => {
    const owner = await registerClient(app);
    const intruder = await registerClient(app);
    await intruder.client
      .post('/api/v1/accounts')
      .send({ ...savings, userId: owner.user.id })
      .expect(400);
  });
});
