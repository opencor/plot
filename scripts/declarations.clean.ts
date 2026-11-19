#!/usr/bin/env bun

// Clean the type declarations that `vue-tsc` emitted for our library (see tsconfig.lib.types.json), i.e.:
//  - remove their CSS side-effect imports (e.g., `import '../assets/theme.css';`); and
//  - remove the type declarations that are not reachable from our entry point (i.e. dist/index.d.ts).
// Note #1: CSS side-effect imports are kept by `vue-tsc` when it emits our type declarations, but they are of no use
//          there (our CSS is bundled into opencor-plot.css) and some of them don't even exist in our package (e.g.,
//          '../assets/theme.css'). So, a project that checks the type declarations of its dependencies (i.e. with
//          skipLibCheck set to false) and that doesn't declare CSS modules (e.g., one that doesn't use Vite) would fail
//          to type check with TypeScript 6 or later (since noUncheckedSideEffectImports is then true by default).
// Note #2: `vue-tsc` emits a type declaration for each of our source files, but only those that are reachable from our
//          entry point are needed (e.g., not the one for our level of detail utilities).

import fs from 'node:fs';
import path from 'node:path';

const DIST_DIRECTORY = 'dist';
const ENTRY_POINT = path.join(DIST_DIRECTORY, 'index.d.ts');
const CSS_IMPORT = /^import\s+['"][^'"]+\.css['"];?\r?\n/gm;
const RELATIVE_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;

const declarationFiles = (directory: string): string[] => {
  // Return the type declarations in the given directory and its subdirectories.

  return fs
    .readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.d.ts'))
    .map((entry) => path.join(directory, entry));
};

const declarationFile = (fromFile: string, specifier: string): string => {
  // Return the type declaration that the given specifier refers to from the given type declaration (e.g.,
  // './src/common/icons' or './src/common/icons.js' refers to src/common/icons.d.ts, and './src/widgets/PlotWidget.vue'
  // to src/widgets/PlotWidget.vue.d.ts).

  const target = path.join(path.dirname(fromFile), specifier.replace(/\.js$/, ''));

  for (const candidate of [`${target}.d.ts`, path.join(target, 'index.d.ts')]) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Cannot find the type declaration for '${specifier}' (imported from ${fromFile}).`);
};

// Remove the CSS side-effect imports from our type declarations (see Note #1 above).

const allFiles = declarationFiles(DIST_DIRECTORY);

for (const file of allFiles) {
  const contents = fs.readFileSync(file, 'utf8');
  const cleanedContents = contents.replace(CSS_IMPORT, '');

  if (cleanedContents !== contents) {
    fs.writeFileSync(file, cleanedContents);
  }
}

// Remove the type declarations that are not reachable from our entry point (see Note #2 above).

const reachableFiles = new Set<string>();
const filesToVisit = [ENTRY_POINT];

for (let file = filesToVisit.pop(); file !== undefined; file = filesToVisit.pop()) {
  if (!reachableFiles.has(file)) {
    reachableFiles.add(file);

    for (const match of fs.readFileSync(file, 'utf8').matchAll(RELATIVE_SPECIFIER)) {
      filesToVisit.push(declarationFile(file, match[1] as string));
    }
  }
}

for (const file of allFiles) {
  if (!reachableFiles.has(file)) {
    fs.rmSync(file);
  }
}

// Remove the directories that are now empty, from the deepest ones.

const directories = fs
  .readdirSync(DIST_DIRECTORY, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(entry.parentPath, entry.name))
  .sort((directory1, directory2) => directory2.length - directory1.length);

for (const directory of directories) {
  if (fs.readdirSync(directory).length === 0) {
    fs.rmdirSync(directory);
  }
}
