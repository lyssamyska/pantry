// Set (or reset) the password for an existing account, e.g. one created
// back when Pantry used Polsia's emailed sign-in codes.
//   npm run set-password -- you@example.com
// Prompts for the password without echoing it. PANTRY_PASSWORD may be set
// instead for non-interactive use.
const readline = require('readline');
const { normalizeEmail, validatePassword, hashPassword } = require('../lib/auth');

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (text) => { if (text.includes(question)) process.stdout.write(text); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

async function main() {
  const email = normalizeEmail(process.argv[2]);
  if (!email) {
    console.error('Usage: npm run set-password -- you@example.com');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL must be set');
    process.exit(1);
  }

  const password = process.env.PANTRY_PASSWORD || await promptHidden('New password: ');
  const problem = validatePassword(password);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }

  const { setPasswordHash } = require('../db/users');
  const { pool } = require('../db/index');
  try {
    const updated = await setPasswordHash(email, await hashPassword(password));
    if (!updated) {
      console.error(`No account found for ${email}. Register in the app instead.`);
      process.exitCode = 1;
    } else {
      console.log(`Password set for ${email}.`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
