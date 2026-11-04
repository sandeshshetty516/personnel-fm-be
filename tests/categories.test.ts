import type request from 'supertest';
import { createApp } from '../src/app';
import { CategoryModel } from '../src/modules/categories/category.model';
import { ensureDefaultCategories } from '../src/modules/categories/categories.service';
import { DEFAULT_CATEGORIES } from '../src/modules/categories/defaultCategories';
import { TransactionModel } from '../src/modules/transactions/transaction.model';
import { registerClient } from './helpers/auth';
import { closeTestDatabase, connectTestDatabase } from './helpers/db';
import { insertTransaction } from './helpers/fixtures';

const app = createApp();

beforeAll(connectTestDatabase);
afterAll(closeTestDatabase);

type Agent = ReturnType<typeof request.agent>;

async function setupWithAccount() {
  const ctx = await registerClient(app);
  const account = await ctx.client.post('/api/v1/accounts').send({ name: 'Cash', accountType: 'CASH' }).expect(201);
  return { ...ctx, accountId: account.body.data.account.id as string };
}

async function categoryByName(client: Agent, name: string) {
  const res = await client.get('/api/v1/categories?includeArchived=true').expect(200);
  return (res.body.data.categories as { id: string; name: string; type: string }[]).find((c) => c.name === name)!;
}

describe('default categories (FR-017)', () => {
  it('gives every new user the default income and expense categories', async () => {
    const { client } = await registerClient(app);
    const res = await client.get('/api/v1/categories').expect(200);
    const categories = res.body.data.categories as { name: string; type: string; isDefault: boolean }[];

    expect(categories).toHaveLength(DEFAULT_CATEGORIES.length);
    expect(categories.every((c) => c.isDefault)).toBe(true);
    expect(categories.filter((c) => c.type === 'INCOME').map((c) => c.name)).toContain('Salary');
    expect(categories.filter((c) => c.type === 'EXPENSE').map((c) => c.name)).toContain('Rent');
  });

  it('seeds only once, even when called concurrently', async () => {
    const { user } = await registerClient(app);
    await Promise.all([ensureDefaultCategories(user.id), ensureDefaultCategories(user.id)]);
    expect(await CategoryModel.countDocuments({ userId: user.id })).toBe(DEFAULT_CATEGORIES.length);
  });

  it('filters by type', async () => {
    const { client } = await registerClient(app);
    const res = await client.get('/api/v1/categories?type=INCOME').expect(200);
    expect(res.body.data.categories.every((c: { type: string }) => c.type === 'INCOME')).toBe(true);
  });
});

describe('custom categories (FR-018, FR-019)', () => {
  it('creates a category with name, type, icon and colour', async () => {
    const { client } = await registerClient(app);
    const res = await client
      .post('/api/v1/categories')
      .send({ name: 'Pets', type: 'EXPENSE', icon: 'pets', color: '#795548' })
      .expect(201);
    expect(res.body.data.category).toMatchObject({
      name: 'Pets',
      type: 'EXPENSE',
      icon: 'pets',
      color: '#795548',
      isDefault: false,
    });
  });

  it('rejects duplicate names within a type (case-insensitive) but allows them across types', async () => {
    const { client } = await registerClient(app);
    await client.post('/api/v1/categories').send({ name: 'salary', type: 'INCOME' }).expect(409);
    await client.post('/api/v1/categories').send({ name: 'Salary', type: 'EXPENSE' }).expect(201);
  });

  it.each([
    [{ name: 'X', type: 'SAVINGS' }, 'type'],
    [{ name: 'X', type: 'EXPENSE', icon: 'rocket' }, 'icon'],
    [{ name: 'X', type: 'EXPENSE', color: 'red' }, 'color'],
  ])('validates input %#', async (payload, field) => {
    const { client } = await registerClient(app);
    const res = await client.post('/api/v1/categories').send(payload).expect(400);
    expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: field })]));
  });

  it('renames and archives a category, but never changes its type', async () => {
    const { client } = await registerClient(app);
    const rent = await categoryByName(client, 'Rent');

    await client.patch(`/api/v1/categories/${rent.id}`).send({ type: 'INCOME' }).expect(400);
    const res = await client
      .patch(`/api/v1/categories/${rent.id}`)
      .send({ name: 'House Rent', isArchived: true })
      .expect(200);
    expect(res.body.data.category).toMatchObject({ name: 'House Rent', isArchived: true, type: 'EXPENSE' });

    const active = await client.get('/api/v1/categories').expect(200);
    expect(active.body.data.categories.map((c: { name: string }) => c.name)).not.toContain('House Rent');
  });
});

describe('safe deletion (FR-020)', () => {
  it('deletes an unused category', async () => {
    const { client } = await registerClient(app);
    const pets = await client.post('/api/v1/categories').send({ name: 'Pets', type: 'EXPENSE' }).expect(201);
    await client.delete(`/api/v1/categories/${pets.body.data.category.id}`).expect(200);
  });

  it('refuses to delete a category referenced by transactions', async () => {
    const { client, user, accountId } = await setupWithAccount();
    const fuel = await categoryByName(client, 'Fuel');
    await insertTransaction({ userId: user.id, accountId, type: 'EXPENSE', amountPaise: 100, categoryId: fuel.id });

    const res = await client.delete(`/api/v1/categories/${fuel.id}`).expect(409);
    expect(res.body.error.details).toEqual({ reason: 'CATEGORY_IN_USE', transactionCount: 1 });
    expect(await CategoryModel.exists({ _id: fuel.id })).not.toBeNull();
  });

  it('reassigns transactions to another category of the same type, then deletes', async () => {
    const { client, user, accountId } = await setupWithAccount();
    const fuel = await categoryByName(client, 'Fuel');
    const transport = await categoryByName(client, 'Transport');
    await insertTransaction({ userId: user.id, accountId, type: 'EXPENSE', amountPaise: 100, categoryId: fuel.id });
    await insertTransaction({ userId: user.id, accountId, type: 'EXPENSE', amountPaise: 200, categoryId: fuel.id });

    const res = await client.delete(`/api/v1/categories/${fuel.id}?reassignTo=${transport.id}`).expect(200);
    expect(res.body.data).toEqual({ deleted: true, reassignedTransactions: 2 });
    expect(await TransactionModel.countDocuments({ categoryId: transport.id })).toBe(2);
    expect(await CategoryModel.exists({ _id: fuel.id })).toBeNull();
  });

  it('only reassigns to an active category of the same type', async () => {
    const { client, user, accountId } = await setupWithAccount();
    const fuel = await categoryByName(client, 'Fuel');
    const salary = await categoryByName(client, 'Salary');
    const travel = await categoryByName(client, 'Travel');
    await insertTransaction({ userId: user.id, accountId, type: 'EXPENSE', amountPaise: 100, categoryId: fuel.id });
    await client.patch(`/api/v1/categories/${travel.id}`).send({ isArchived: true }).expect(200);

    await client.delete(`/api/v1/categories/${fuel.id}?reassignTo=${salary.id}`).expect(400);
    await client.delete(`/api/v1/categories/${fuel.id}?reassignTo=${travel.id}`).expect(400);
    await client.delete(`/api/v1/categories/${fuel.id}?reassignTo=${fuel.id}`).expect(400);
  });
});

describe('data isolation (AC-03)', () => {
  it("cannot see, edit, delete or reassign into another user's categories", async () => {
    const owner = await setupWithAccount();
    const intruder = await setupWithAccount();
    const ownerFuel = await categoryByName(owner.client, 'Fuel');
    const intruderFuel = await categoryByName(intruder.client, 'Fuel');
    await insertTransaction({
      userId: intruder.user.id,
      accountId: intruder.accountId,
      type: 'EXPENSE',
      amountPaise: 100,
      categoryId: intruderFuel.id,
    });

    await intruder.client.patch(`/api/v1/categories/${ownerFuel.id}`).send({ name: 'Hacked' }).expect(404);
    await intruder.client.delete(`/api/v1/categories/${ownerFuel.id}`).expect(404);
    await intruder.client.delete(`/api/v1/categories/${intruderFuel.id}?reassignTo=${ownerFuel.id}`).expect(404);

    const ids = (await intruder.client.get('/api/v1/categories').expect(200)).body.data.categories.map(
      (c: { id: string }) => c.id,
    );
    expect(ids).not.toContain(ownerFuel.id);
    expect((await categoryByName(owner.client, 'Fuel')).name).toBe('Fuel');
  });
});
