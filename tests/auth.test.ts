import request from 'supertest';
import { createApp } from '../src/app';
import { passwordResetNotifier } from '../src/modules/auth/passwordResetNotifier';
import { SessionModel } from '../src/modules/auth/session.model';
import { UserModel } from '../src/modules/users/user.model';
import {
  createClient,
  DEFAULT_PASSWORD,
  getCookie,
  getSetCookieHeader,
  registerClient,
  uniqueEmail,
  withCookies,
} from './helpers/auth';
import { closeTestDatabase, connectTestDatabase } from './helpers/db';

const app = createApp();

beforeAll(connectTestDatabase);
afterAll(closeTestDatabase);

describe('CSRF protection', () => {
  it('rejects state-changing requests without a token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'a@example.com', password: 'x' })
      .expect(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });

  it('rejects a header that does not match the cookie', async () => {
    const client = await createClient(app);
    client.set('X-CSRF-Token', 'forged-token-value-that-does-not-match-cookie');
    await client.post('/api/v1/auth/login').send({ email: 'a@example.com', password: 'x' }).expect(403);
  });
});

describe('POST /auth/register (AC-01)', () => {
  it('creates the user, sets HttpOnly auth cookies and never returns or stores the plaintext password', async () => {
    const client = await createClient(app);
    const email = uniqueEmail();
    const res = await client
      .post('/api/v1/auth/register')
      .send({ fullName: 'Asha Rao', email: email.toUpperCase(), password: DEFAULT_PASSWORD })
      .expect(201);

    expect(res.body.data.user).toMatchObject({ fullName: 'Asha Rao', email, currency: 'INR', monthStartDay: 1 });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);

    expect(getSetCookieHeader(res, 'mf_access')).toMatch(/HttpOnly/);
    expect(getSetCookieHeader(res, 'mf_refresh')).toMatch(/HttpOnly/);
    expect(getSetCookieHeader(res, 'mf_refresh')).toMatch(/Path=\/api\/v1\/auth/);

    const stored = await UserModel.findOne({ email }).select('+passwordHash').lean();
    expect(stored?.passwordHash).toBeDefined();
    expect(stored?.passwordHash).not.toBe(DEFAULT_PASSWORD);
    expect(stored?.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('rejects a duplicate email regardless of case', async () => {
    const { credentials } = await registerClient(app);
    const client = await createClient(app);
    const res = await client
      .post('/api/v1/auth/register')
      .send({ ...credentials, email: credentials.email.toUpperCase() })
      .expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it.each([
    [{ fullName: 'A', email: 'ok@example.com', password: DEFAULT_PASSWORD }, 'fullName'],
    [{ fullName: 'Asha', email: 'not-an-email', password: DEFAULT_PASSWORD }, 'email'],
    [{ fullName: 'Asha', email: 'ok@example.com', password: 'short1' }, 'password'],
    [{ fullName: 'Asha', email: 'ok@example.com', password: 'lettersonly' }, 'password'],
  ])('validates input %#', async (payload, field) => {
    const client = await createClient(app);
    const res = await client.post('/api/v1/auth/register').send(payload).expect(400);
    expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: field })]));
  });
});

describe('login, session restoration and logout (AC-02)', () => {
  it('logs in, restores the session via /auth/me, and logout invalidates it', async () => {
    const { credentials } = await registerClient(app);
    const client = await createClient(app);

    await client.get('/api/v1/auth/me').expect(401);

    await client
      .post('/api/v1/auth/login')
      .send({ email: credentials.email, password: credentials.password })
      .expect(200);
    const me = await client.get('/api/v1/auth/me').expect(200);
    expect(me.body.data.user.email).toBe(credentials.email);

    await client.post('/api/v1/auth/logout').expect(200);
    await client.get('/api/v1/auth/me').expect(401);
  });

  it('rejects the old access token after logout even if it is replayed', async () => {
    const { client, accessToken } = await registerClient(app);
    await withCookies(app, { mf_access: accessToken }).get('/api/v1/auth/me').expect(200);

    await client.post('/api/v1/auth/logout').expect(200);
    await withCookies(app, { mf_access: accessToken }).get('/api/v1/auth/me').expect(401);
  });

  it('returns the same generic error for unknown email and wrong password', async () => {
    const { credentials } = await registerClient(app);
    const client = await createClient(app);

    const wrongPassword = await client
      .post('/api/v1/auth/login')
      .send({ email: credentials.email, password: 'Wrong1234' })
      .expect(401);
    const unknownEmail = await client
      .post('/api/v1/auth/login')
      .send({ email: uniqueEmail(), password: 'Wrong1234' })
      .expect(401);

    expect(wrongPassword.body.error.message).toBe('Invalid email or password');
    expect(unknownEmail.body.error).toEqual(wrongPassword.body.error);
  });

  it('rejects a tampered access token', async () => {
    await request(app).get('/api/v1/auth/me').set('Cookie', 'mf_access=not.a.jwt').expect(401);
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the refresh token and keeps the user signed in', async () => {
    const { client } = await registerClient(app);
    const res = await client.post('/api/v1/auth/refresh').expect(200);

    expect(res.body.data.user.email).toBeDefined();
    expect(getCookie(res, 'mf_refresh')).toBeDefined();
    await client.get('/api/v1/auth/me').expect(200);
  });

  it('tolerates a concurrent replay within the grace period without signing the user out', async () => {
    const { client, refreshToken: oldToken } = await registerClient(app);
    await client.post('/api/v1/auth/refresh').expect(200);

    await withCookies(app, { mf_refresh: oldToken }).post('/api/v1/auth/refresh').expect(401);
    await client.get('/api/v1/auth/me').expect(200);
  });

  it('revokes the whole session family when a rotated refresh token is replayed later (theft detection)', async () => {
    const { client, user, refreshToken: oldToken } = await registerClient(app);
    await client.post('/api/v1/auth/refresh').expect(200);

    // Move the old token's revocation outside the grace window, as if replayed much later.
    await SessionModel.updateOne(
      { userId: user.id, replacedBy: { $exists: true } },
      { $set: { revokedAt: new Date(Date.now() - 60_000) } },
    );
    await withCookies(app, { mf_refresh: oldToken }).post('/api/v1/auth/refresh').expect(401);

    // The legitimate client's newer session is gone too.
    await client.get('/api/v1/auth/me').expect(401);
    expect(await SessionModel.countDocuments({ userId: user.id, revokedAt: null })).toBe(0);
  });

  it('fails without a refresh cookie', async () => {
    const client = await createClient(app);
    await client.post('/api/v1/auth/refresh').expect(401);
  });
});

describe('forgot and reset password (FR-005)', () => {
  it('returns the same response for unknown emails', async () => {
    const send = jest.spyOn(passwordResetNotifier, 'send');
    const client = await createClient(app);
    const res = await client.post('/api/v1/auth/forgot-password').send({ email: uniqueEmail() }).expect(200);

    expect(res.body.data.message).toMatch(/If an account exists/);
    expect(send).not.toHaveBeenCalled();
    send.mockRestore();
  });

  it('resets the password with a one-time token and signs out existing sessions', async () => {
    const send = jest.spyOn(passwordResetNotifier, 'send').mockResolvedValue();
    const { client: existingSession, credentials } = await registerClient(app);
    const client = await createClient(app);

    await client.post('/api/v1/auth/forgot-password').send({ email: credentials.email }).expect(200);
    expect(send).toHaveBeenCalledTimes(1);
    const resetUrl = new URL(send.mock.calls[0]![1]);
    expect(resetUrl.pathname).toBe('/reset-password');
    const token = resetUrl.searchParams.get('token')!;

    await client.post('/api/v1/auth/reset-password').send({ token, password: 'NewSecret456' }).expect(200);
    await existingSession.get('/api/v1/auth/me').expect(401);

    // Token is single-use.
    await client.post('/api/v1/auth/reset-password').send({ token, password: 'Another789' }).expect(400);

    await client
      .post('/api/v1/auth/login')
      .send({ email: credentials.email, password: credentials.password })
      .expect(401);
    await client.post('/api/v1/auth/login').send({ email: credentials.email, password: 'NewSecret456' }).expect(200);
    send.mockRestore();
  });

  it('rejects an expired token', async () => {
    const send = jest.spyOn(passwordResetNotifier, 'send').mockResolvedValue();
    const { credentials } = await registerClient(app);
    const client = await createClient(app);

    await client.post('/api/v1/auth/forgot-password').send({ email: credentials.email }).expect(200);
    const token = new URL(send.mock.calls[0]![1]).searchParams.get('token')!;
    await UserModel.updateOne(
      { email: credentials.email },
      { $set: { passwordResetExpiresAt: new Date(Date.now() - 1000) } },
    );

    await client.post('/api/v1/auth/reset-password').send({ token, password: 'NewSecret456' }).expect(400);
    send.mockRestore();
  });
});
