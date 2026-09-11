import { defineConfig } from 'vite';

// Local auth shares Vite's origin/lifecycle. Production stays on the existing API.
function localAuth() {
  async function mount(server) {
    const [{ default: express }, { createAuthRouter }, { MemoryAccountStore }] = await Promise.all([
      import('express'), import('./server/src/auth/router.js'), import('./server/src/auth/accountStore.js')
    ]);
    const app = express(), store = new MemoryAccountStore();
    app.use(express.json({ limit: '8kb' }));
    app.use(createAuthRouter({ getStore: () => store, production: false }));
    server.middlewares.use('/api/v1/auth', app);
    const { attachOnline } = await import('./server/src/online/socket.js');
    attachOnline(server.httpServer);
    server.config.logger.info('Local player accounts enabled (temporary until this preview restarts).');
  }
  return { name: 'quick-grid-local-auth', configureServer: mount, configurePreviewServer: mount };
}

export default defineConfig({
  plugins: [localAuth()],
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' }
});
