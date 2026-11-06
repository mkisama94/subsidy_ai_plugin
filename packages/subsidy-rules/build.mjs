import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
await build({entryPoints:[fileURLToPath(new URL('index.ts',import.meta.url))],outfile:fileURLToPath(new URL('dist/index.js',import.meta.url)),bundle:true,format:'esm',platform:'neutral',sourcemap:'inline',banner:{js:'// @subsidy-ai/rules 0.1.0 — AGPL-3.0-only; generated from subsidy_ai_plugin/src/matching.ts. See LICENSE.'}});
await copyFile(new URL('../../LICENSE',import.meta.url),new URL('LICENSE',import.meta.url));
