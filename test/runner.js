import fs from 'node:fs';
import path from 'node:path';
import { run } from 'node:test';
import { spec as Spec } from 'node:test/reporters';

function findTests(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findTests(full));
    } else if (entry.name.endsWith('.test.ts') && !entry.name.endsWith('runner.js')) {
      files.push(full);
    }
  }
  return files;
}

process.env.ADMIN_PASSWORD = 'test-fixture-admin-password';
process.env.SUPABASE_URL = 'https://fixture.invalid';
process.env.SUPABASE_KEY = 'test-fixture-publishable-key';
process.env.DISABLE_SUPABASE = 'true';

const files = findTests('test');
const stream = run({ files });
stream.compose(new Spec()).pipe(process.stdout);
let failed = false;
stream.on('test:fail', () => { failed = true; });
stream.on('end', () => {
  process.exit(failed ? 1 : 0);
});
