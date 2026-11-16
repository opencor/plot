import vuePlugin from '@vitejs/plugin-vue';
import * as vite from 'vite';

import { componentsPlugin } from './vite.plugins.ts';

export default vite.defineConfig({
  build: {
    lib: {
      entry: './index.ts',
      fileName: (format) => `opencor-plot.${format}.js`,
      cssFileName: 'opencor-plot',
      formats: ['es']
    },
    rolldownOptions: {
      external: ['vue'],
      output: {
        exports: 'named'
      }
    },
    target: 'esnext',
    copyPublicDir: false
  },
  plugins: [vuePlugin(), componentsPlugin()]
});
