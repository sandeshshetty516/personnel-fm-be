import request from 'supertest';
import { createApp } from '../src/app';
import { createClient, DEFAULT_PASSWORD, registerClient } from './helpers/auth';
import { closeTestDatabase, connectTestDatabase } from './helpers/db';

const app = createApp();

beforeAll(connectTestDatabase);
afterAll(closeTestDatabase);

describe('protected user endpoints', () => {
  it('require authentication', async () => {
    await request(app).get('/api/v1/users/me').expect(401);
    const client = await createClient(app);
    await client.patch('/api/v1/users/me').send({ fullName: 'Nope' }).expect(401);
  });
});

describe('PATCH /users/me (FR-006, FR-008)', () => {
  it('updates profile settings and merges notification preferences', async () => {
    const { client } = await registerClient(app);

    const res = await client
      .patch('/api/v1/users/me')
      .send({
        fullName: 'Asha R',
        currency: 'USD',
        monthStartDay: 25,
        timezone: 'Europe/London',
        preferences: { notifications: { emiReminders: false } },
      })
      .expect(200);

    expect(res.body.data.user).toMatchObject({
      fullName: 'Asha R',
      currency: 'USD',
      monthStartDay: 25,
      timezone: 'Europe/London',
      preferences: {
        notifications: { budgetAlerts: true, emiReminders: false, recurringReminders: true, goalMilestones: true },
      },
    });
  });

  it.each([
    [{ monthStartDay: 29 }, 'monthStartDay'],
    [{ currency: 'XYZ' }, 'currency'],
    [{ timezone: 'Mars/Olympus' }, 'timezone'],
  ])('rejects invalid settings %#', async (payload, field) => {
    const { client } = await registerClient(app);
    const res = await client.patch('/api/v1/users/me').send(payload).expect(400);
    expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: field })]));
  });

  it('cannot change email or password through the profile endpoint', async () => {
    const { client } = await registerClient(app);
    await client.patch('/api/v1/users/me').send({ email: 'other@example.com' }).expect(400);
    await client.patch('/api/v1/users/me').send({ passwordHash: 'x' }).expect(400);
  });
});

describe('POST /users/me/change-password (FR-007)', () => {
  it('requires the current password', async () => {
    const { client } = await registerClient(app);
    const res = await client
      .post('/api/v1/users/me/change-password')
      .send({ currentPassword: 'Wrong1234', newPassword: 'NewSecret456' })
      .expect(400);
    expect(res.body.error.details[0].path).toBe('currentPassword');
  });

  it('changes the password, keeps this session and signs out other sessions', async () => {
    const { client, credentials } = await registerClient(app);
    const otherDevice = await createClient(app);
    await otherDevice
      .post('/api/v1/auth/login')
      .send({ email: credentials.email, password: credentials.password })
      .expect(200);

    await client
      .post('/api/v1/users/me/change-password')
      .send({ currentPassword: DEFAULT_PASSWORD, newPassword: 'NewSecret456' })
      .expect(200);

    await client.get('/api/v1/users/me').expect(200);
    await otherDevice.get('/api/v1/users/me').expect(401);

    const fresh = await createClient(app);
    await fresh
      .post('/api/v1/auth/login')
      .send({ email: credentials.email, password: credentials.password })
      .expect(401);
    await fresh.post('/api/v1/auth/login').send({ email: credentials.email, password: 'NewSecret456' }).expect(200);
  });
});
