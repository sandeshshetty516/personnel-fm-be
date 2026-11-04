import request from 'supertest';
import { createApp } from '../src/app';
import { disconnectDatabase } from '../src/config/db';
import { closeTestDatabase, connectTestDatabase } from './helpers/db';

const app = createApp();

describe('GET /api/v1/health', () => {
  it('reports degraded with 503 when the database is not connected', async () => {
    await disconnectDatabase();
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ success: true, data: { status: 'degraded', database: 'disconnected' } });
  });

  describe('with a database connection', () => {
    beforeAll(connectTestDatabase);
    afterAll(closeTestDatabase);

    it('reports ok', async () => {
      const res = await request(app).get('/api/v1/health');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, data: { status: 'ok', database: 'connected' } });
      expect(typeof res.body.data.uptimeSeconds).toBe('number');
    });
  });
});

describe('error handling', () => {
  it('returns a 404 envelope for unknown routes', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Route GET /api/v1/does-not-exist not found' },
    });
  });

  it('rejects malformed JSON with 400 and no stack trace', async () => {
    const res = await request(app).post('/api/v1/health').set('Content-Type', 'application/json').send('{"broken":');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts/);
  });
});

describe('security middleware', () => {
  it('sets Helmet headers and hides x-powered-by', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows credentialed CORS for an allowlisted origin', async () => {
    const res = await request(app).get('/api/v1/health').set('Origin', 'http://localhost:5173');

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('rejects a non-allowlisted origin', async () => {
    const res = await request(app).get('/api/v1/health').set('Origin', 'https://evil.example');

    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('API docs', () => {
  it('serves the OpenAPI document including the health path', async () => {
    const res = await request(app).get('/api/docs.json');

    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.paths['/health']).toBeDefined();
  });
});
