import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('OpenAPI docs', () => {
  it('serves the spec at /docs/json with the credit routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);

    const spec = res.json();
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.title).toContain('Credit');
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/credit/me/balance',
        '/api/v1/credit/internal/reserve',
        '/api/v1/credit/internal/release',
        '/health',
      ]),
    );
    // The old paths before the /internal prefix are gone.
    expect(spec.paths).not.toHaveProperty(['/api/v1/credit/reserve']);
    expect(spec.paths).not.toHaveProperty(['/api/v1/credit/release']);
    // The reserve body schema is carried through from the TypeBox schema.
    expect(
      spec.paths['/api/v1/credit/internal/reserve'].post.requestBody.content['application/json'].schema
        .properties,
    ).toHaveProperty('amount');
  });

  it('serves the Swagger UI at /docs', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs' });
    expect([200, 301, 302]).toContain(res.statusCode);
  });
});
