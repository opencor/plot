#!/usr/bin/env bun

import fs from 'node:fs';

for (const path of ['components.d.ts', 'coverage', 'demo/dist', 'dist', 'node_modules']) {
  if (fs.existsSync(path)) {
    fs.rmSync(path, { recursive: true, force: true });
  }
}
