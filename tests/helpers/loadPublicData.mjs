// Loads publicBookingData/entry.ts under Node. Same approach as loadEntry, plus the one extra
// import the page-data function has (`base44:runtime` secrets), which Node cannot resolve.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url);
let counter = 0;

export async function loadPublicData() {
  const src = readFileSync(new URL('base44/functions/publicBookingData/entry.ts', root), 'utf8');
  const shared = pathToFileURL(fileURLToPath(new URL('base44/shared/', root))).href + '/';
  const patched = src
    .replace(/import \{ createClientFromRequest \} from 'npm:@base44\/sdk@[^']+';/, 'const createClientFromRequest = (req) => globalThis.__b44Client(req);')
    .replace("import { secrets } from 'base44:runtime';", 'const secrets = { get: () => null };')
    .replaceAll("'../../shared/", `'${shared}`);
  const dir = join(tmpdir(), 'cd-entry-tests');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `publicBookingData-${process.pid}-${++counter}.ts`);
  writeFileSync(file, patched);
  return (await import(pathToFileURL(file).href)).default;
}