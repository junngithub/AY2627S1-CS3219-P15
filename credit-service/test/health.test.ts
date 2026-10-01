import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/database/index.js';

describe('health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /health/db reports the database is reachable', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/db' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'up' });
  });

  it('GET /health/db returns 503 when the database is unreachable', async () => {
    const spy = vi.spyOn(db, 'execute').mockRejectedValueOnce(new Error('connection refused'));
    const res = await app.inject({ method: 'GET', url: '/health/db' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'error', db: 'down' });
    spy.mockRestore();
  });
});
