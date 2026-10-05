import { defineConfig } from 'vite';

export default defineConfig({
  /*
   * GitHub Pages serves a project site from a sub-path (/<repo>/), so the built asset URLs have
   * to be prefixed or every script and stylesheet 404s. Local dev and tests keep the root base.
   */
  base: process.env.VITE_BASE ?? '/',
  server: {
    // Listen on every interface so other machines on the LAN can open the game. Vite prints the
    // Network URL on startup; use that address from another host.
    host: true,
    port: 5188,
    strictPort: true,
  },
  preview: {
    host: true,
    port: 4188,
    strictPort: true,
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
