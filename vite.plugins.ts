import path from 'node:path';
import vueComponentsPlugin from 'unplugin-vue-components/vite';

// Auto-import our components, so that they can be used in templates without being imported.
// Note: this plugin is used by both our library (see vite.lib.config.ts) and our demo app (see vite.config.ts), which
//       have different roots, hence our absolute paths. They also both generate components.d.ts, which is why they must
//       use the same options.

export const componentsPlugin = () =>
  vueComponentsPlugin({
    dirs: [path.join(import.meta.dirname, 'src/widgets')],
    dts: path.join(import.meta.dirname, 'components.d.ts')
  });
