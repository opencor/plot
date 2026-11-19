import vuePlugin from '@vitejs/plugin-vue';
import * as vite from 'vite';

// Note: this configuration is for our demo app, which uses our component from its sources (rather than from our library
//       build, see vite.lib.config.ts), so that changes to our component get hot-reloaded.

export default vite.defineConfig({
  root: 'demo',
  plugins: [vuePlugin()]
});
