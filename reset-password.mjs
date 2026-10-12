// Set a new password for any login (for example when the owner forgets theirs).
//   npm run reset-password -- <username> <new-password>
// Add --local to change the local test database instead of the live one.
import { execSync } from 'node:child_process';
import { pbkdf2Sync, randomBytes } from 'node:crypto';

const args = process.argv.slice(2);
const local = args.includes('--local');
const [username, password] = args.filter((a) => a !== '--local');
if (!username || !password || password.length < 6) {
  console.log('Usage: npm run reset-password -- <username> <new-password>   (password at least 6 characters)');
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username) || /["']/.test(password)) {
  console.log('Invalid username, or the password contains quotes.');
  process.exit(1);
}

const ITERATIONS = 20000; // same as worker/index.js
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256').toString('base64');
const sql = `UPDATE users SET pass_hash = '${hash}', pass_salt = '${salt.toString('base64')}', pass_iter = ${ITERATIONS}, active = 1 WHERE username = '${username}'; `
  + `DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = '${username}'); `
  + `DELETE FROM login_failures WHERE username = '${username}';`;

const d1 = (command) => JSON.parse(execSync(
  `npx wrangler d1 execute petrol-pump-crm ${local ? '--local' : '--remote'} --json --command "${command}"`,
  { encoding: 'utf8', env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' } },
));

const found = d1(`SELECT COUNT(*) AS n FROM users WHERE username = '${username}'`)[0].results[0].n;
if (!found) {
  console.log(`No login named "${username}" was found.`);
  process.exit(1);
}
d1(sql);
console.log(`Password changed for "${username}". They can sign in with the new password now.`);
