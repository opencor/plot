import vuePlugin from '@vitejs/plugin-vue';
import * as vite from 'vite';

export default vite.defineConfig({
  build: {
    lib: {
      entry: './index.ts',
      fileName: (format) => `opencor-plot.${format}.js`,
      cssFileName: 'opencor-plot',
      formats: ['es']
    },
    rolldownOptions: {
      // Note: our dependencies are not bundled, but uPlot's CSS is (i.e. uplot/dist/uPlot.min.css is not external), so
      //       that our CSS (i.e. opencor-plot.css) is all that is needed.

      external: ['uplot', 'vue']
    },
    target: 'esnext'
  },
  plugins: [vuePlugin()]
});
