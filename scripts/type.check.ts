#!/usr/bin/env node

// Type-checking wrapper for projects that use TypeScript 7 while `vue-tsc` still expects TypeScript 6 internals.
// Note: this requires the `typescript-6` package alias to be installed in the project (so that we can have both
//       TypeScript 6 and TypeScript 7 installed at the same time).

import { createRequire } from 'node:module';
import path from 'node:path';

// Run `vue-tsc` using the `tsc` from TypeScript 6.
// Note: `vue-tsc` adds support for Vue files to `tsc` by patching its code and then compiling it using
//       Module#_compile() (see runTsc() in @volar/typescript), something that works with both Node.js and Bun. If the
//       patching fails, then `vue-tsc` throws an error, so our type checking cannot silently succeed without having
//       checked any Vue file.

const require = createRequire(path.join(process.cwd(), 'package.json'));
const vueTsc = require('vue-tsc') as { run: (tscPath?: string) => void };

vueTsc.run(require.resolve('typescript-6/lib/tsc'));
