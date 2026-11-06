// Serves /api/* inside the Vite dev server, through the same handlers as the deployed functions.
// `--mode fake` swaps in invented results. The production build never includes this file.
import type { IncomingMessage } from 'node:http';
import { resolve } from 'node:path';
import { loadEnv } from 'vite';
import type { Plugin } from 'vite';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((done, fail) => {
    const parts: Buffer[] = [];
    req.on('data', (part: Buffer) => parts.push(part));
    req.on('end', () => done(Buffer.concat(parts).toString('utf8')));
    req.on('error', fail);
  });
}

export function devApi(mode: string, repoRoot: string): Plugin {
  return {
    name: 'gatehouse-dev-api',
    apply: 'serve',
    configureServer(server) {
      const env = loadEnv(mode, repoRoot, '');
      const load = (path: string) => server.ssrLoadModule(resolve(repoRoot, path));

      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0];
        if (path !== '/api/scenarios' && path !== '/api/review') return next();
        void (async () => {
          const handlers = await load('src/server/handlers.ts');
          const { send } = await load('src/server/vercel.ts');
          const deps = mode === 'fake'
            ? await (await load('src/server/__fixtures__/devDeps.ts')).fakeDeps(env)
            : handlers.liveDeps(env);
          const request = {
            method: req.method ?? 'GET',
            ip: req.socket.remoteAddress ?? 'local',
            body: req.method === 'POST' ? await readBody(req) : undefined,
          };
          const handle = path === '/api/scenarios' ? handlers.handleScenarios : handlers.handleReview;
          send(res, await handle(request, deps));
        })().catch(next);
      });
    },
  };
}
