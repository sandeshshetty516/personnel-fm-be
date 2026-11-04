import type { Express } from 'express';
import request from 'supertest';

export const DEFAULT_PASSWORD = 'Secret123';

let counter = 0;
export function uniqueEmail() {
  counter += 1;
  return `user${counter}-${Date.now()}@example.com`;
}

/** A cookie-keeping client that behaves like the frontend: it fetches a CSRF token and sends it on every request. */
export async function createClient(app: Express) {
  const agent = request.agent(app);
  const res = await agent.get('/api/v1/auth/csrf').expect(200);
  agent.set('X-CSRF-Token', res.body.data.csrfToken);
  return agent;
}

export async function registerClient(
  app: Express,
  overrides: Partial<{ fullName: string; email: string; password: string }> = {},
) {
  const client = await createClient(app);
  const credentials = { fullName: 'Asha Rao', email: uniqueEmail(), password: DEFAULT_PASSWORD, ...overrides };
  const res = await client.post('/api/v1/auth/register').send(credentials).expect(201);
  return {
    client,
    credentials,
    user: res.body.data.user as { id: string; email: string },
    accessToken: getCookie(res, 'mf_access')!,
    refreshToken: getCookie(res, 'mf_refresh')!,
  };
}

/** A request carrying only the given cookies plus a self-consistent CSRF pair (as a replaying attacker would). */
export function withCookies(app: Express, cookies: Record<string, string>) {
  const csrf = 'replay-csrf-token';
  const cookieHeader = Object.entries({ ...cookies, mf_csrf: csrf }).map(([k, v]) => `${k}=${v}`);
  return {
    get: (url: string) => request(app).get(url).set('Cookie', cookieHeader),
    post: (url: string) => request(app).post(url).set('Cookie', cookieHeader).set('X-CSRF-Token', csrf),
  };
}

/** Extracts a cookie value from a Set-Cookie response header. */
export function getCookie(res: request.Response, name: string): string | undefined {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  const match = header?.find((c) => c.startsWith(`${name}=`));
  return match?.split(';')[0]?.slice(name.length + 1);
}

export function getSetCookieHeader(res: request.Response, name: string): string | undefined {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  return header?.find((c) => c.startsWith(`${name}=`));
}
