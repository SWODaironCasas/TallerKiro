import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from 'node:net';
import { dirname, relative, resolve } from 'node:path';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';

const REQUIRED_ROUTES = [
  'GET /',
  'GET /health',
  'POST /tickets',
  'GET /tickets',
  'GET /tickets/:id',
  'PATCH /tickets/:id/assignment',
  'PATCH /tickets/:id/status',
  'GET /tickets/:id/history',
  'GET /tickets/overdue',
] as const;

const VALID_TICKET = {
  title: 'VPN access failure',
  description: 'The user cannot connect from the office.',
  category: 'ACCESOS',
  priority: 'ALTA',
  requester: 'user-123',
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }

    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
      ? [path]
      : [];
  });
}

describe('application startup and service information', () => {
  it('returns the service name, status, and complete required route catalog', async () => {
    const response = await request(createApp()).get('/');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      name: 'TicketOps API',
      status: 'ok',
      routes: [...REQUIRED_ROUTES],
    });
  });

  it('returns exactly the minimal health response', async () => {
    const response = await request(createApp()).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('imports app.ts without opening a listener', async () => {
    const listenSpy = vi.spyOn(Server.prototype, 'listen');

    try {
      vi.resetModules();
      await import('../app.js');

      expect(listenSpy).not.toHaveBeenCalled();
    } finally {
      listenSpy.mockRestore();
    }
  });

  it('keeps server.ts as the only production module that calls listen', () => {
    const httpSourceDirectory = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '..',
    );
    const listenCallFiles = sourceFiles(httpSourceDirectory)
      .filter((path) => /\.listen\s*\(/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(httpSourceDirectory, path).replaceAll('\\', '/'));

    expect(listenCallFiles).toEqual(['server.ts']);
  });

  it('starts each fresh app instance empty and without persistent storage', async () => {
    const firstApp = createApp();
    const createResponse = await request(firstApp)
      .post('/tickets')
      .send(VALID_TICKET);

    expect(createResponse.status).toBe(201);
    expect((await request(firstApp).get('/tickets')).body).toHaveLength(1);

    const freshApp = createApp();
    const freshResponse = await request(freshApp).get('/tickets');

    expect(freshResponse.status).toBe(200);
    expect(freshResponse.body).toEqual([]);
  });
});
