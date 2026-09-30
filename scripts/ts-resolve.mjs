/**
 * Node ESM resolves relative specifiers literally, so `from './fhir'` fails
 * under plain Node even though Metro handles it fine. Rather than add `.ts`
 * extensions to the app source (which would fight the bundler), this hook
 * maps extensionless relative specifiers onto their TypeScript files.
 *
 * Used only by scripts/parser.test.mjs.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CANDIDATES = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    const base = new URL(specifier, context.parentURL);
    for (const ext of CANDIDATES) {
      const candidate = new URL(base.href + ext);
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(pathToFileURL(fileURLToPath(candidate)).href, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
