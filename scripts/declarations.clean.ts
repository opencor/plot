#!/usr/bin/env bun

// Remove the CSS side-effect imports (e.g., `import '../assets/theme.css';`) from our type declarations.
// Note: those imports are kept by `vue-tsc` when it emits our type declarations, but they are of no use there (our CSS
//       is bundled into opencor-plot.css) and some of them don't even exist in our package (e.g.,
//       '../assets/theme.css'). So, a project that checks the type declarations of its dependencies (i.e. with
//       skipLibCheck set to false) and that doesn't declare CSS modules (e.g., one that doesn't use Vite) would fail to
//       type check with TypeScript 6 or later (since noUncheckedSideEffectImports is then true by default).

import fs from 'node:fs';
import path from 'node:path';

const CSS_IMPORT = /^import\s+['"][^'"]+\.css['"];?\r?\n/gm;

const cleanDeclarations = (directory: string): void => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      cleanDeclarations(entryPath);
    } else if (entry.name.endsWith('.d.ts')) {
      const contents = fs.readFileSync(entryPath, 'utf8');
      const cleanedContents = contents.replace(CSS_IMPORT, '');

      if (cleanedContents !== contents) {
        fs.writeFileSync(entryPath, cleanedContents);
      }
    }
  }
};

cleanDeclarations('dist');
