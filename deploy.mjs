// One-command deploy to Cloudflare:  npm run deploy
// 1. creates the D1 database the first time (and writes its id into wrangler.toml)
// 2. applies database migrations
// 3. uploads the Worker and the app files
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const DB_NAME = 'petrol-pump-crm';
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
const run = (cmd) => execSync(cmd, { stdio: 'inherit', env });
const read = (cmd) => execSync(cmd, { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });

function step(text) { console.log(`\n=== ${text} ===`); }

try {
  step('Checking Cloudflare login');
  try {
    read('npx wrangler whoami');
  } catch {
    console.log('Not logged in. Run:  npx wrangler login   and then run  npm run deploy  again.');
    process.exit(1);
  }

  step('Database');
  const findDb = () => JSON.parse(read('npx wrangler d1 list --json')).find((d) => d.name === DB_NAME);
  let db = findDb();
  if (!db) {
    console.log(`Creating database "${DB_NAME}"…`);
    run(`npx wrangler d1 create ${DB_NAME} --location apac`);
    db = findDb();
  }
  if (!db) throw new Error('Could not find the database after creating it.');
  const id = db.uuid || db.id;
  const toml = readFileSync('wrangler.toml', 'utf8');
  const updated = toml.replace(/database_id = "[^"]*"/, `database_id = "${id}"`);
  if (updated !== toml) writeFileSync('wrangler.toml', updated);
  console.log(`Database id: ${id}`);

  step('Updating database tables');
  run(`npx wrangler d1 migrations apply ${DB_NAME} --remote`);

  step('Uploading the app');
  // Not in CI mode, so a brand-new account can pick its workers.dev name if asked.
  execSync('npx wrangler deploy', { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });

  console.log('\nDone. Open the https://…workers.dev link shown above.');
} catch (err) {
  console.error(`\nDeploy failed: ${err.message}`);
  console.error('Take a screenshot of this window and send it to the developer.');
  process.exit(1);
}
