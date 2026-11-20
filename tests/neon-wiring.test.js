const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { poolConfig, isLocalDatabase, appDatabaseUrl, migrationDatabaseUrl } = require('../lib/db-config');
const { loadEnvFiles, parseEnvFile } = require('../lib/load-env');

const NEON_POOLED = 'postgresql://user:pw@ep-example-123-pooler.c-8.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const NEON_DIRECT = 'postgresql://user:pw@ep-example-123.c-8.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

test('Neon URLs get verified TLS and channel binding; local URLs get neither', () => {
  const neon = poolConfig(NEON_POOLED);
  assert.equal(neon.connectionString, NEON_POOLED);
  assert.equal(neon.ssl, true, 'TLS must be verified, never rejectUnauthorized:false');
  assert.equal(neon.enableChannelBinding, true);
  assert.equal(neon.connectionTimeoutMillis, 15000);

  const noBinding = poolConfig('postgresql://u:p@ep-x.neon.tech/db?sslmode=require');
  assert.equal(noBinding.ssl, true);
  assert.equal(noBinding.enableChannelBinding, false);

  const local = poolConfig('postgres://postgres@localhost:5433/pantry');
  assert.equal(local.ssl, false);
  assert.equal(local.enableChannelBinding, false);
  assert.equal(isLocalDatabase('postgres://u@127.0.0.1/db'), true);
  assert.equal(isLocalDatabase(NEON_POOLED), false);
  assert.equal(poolConfig('postgres://u@db.internal/x?sslmode=disable').ssl, false);
});

test('missing URL still builds a pool config (queries fail later, imports do not)', () => {
  const config = poolConfig(undefined, { max: 3 });
  assert.equal(config.connectionString, undefined);
  assert.equal(config.max, 3);
});

test('app uses the pooled URL; migrations prefer the direct URL', () => {
  const env = { DATABASE_URL: NEON_POOLED, DATABASE_URL_UNPOOLED: NEON_DIRECT };
  assert.equal(appDatabaseUrl(env), NEON_POOLED);
  assert.equal(migrationDatabaseUrl(env), NEON_DIRECT);
  assert.equal(migrationDatabaseUrl({ DATABASE_URL: NEON_POOLED }), NEON_POOLED);
});

test('parses the .env format neon env pull writes', () => {
  const parsed = parseEnvFile([
    '# Neon',
    `DATABASE_URL="${NEON_POOLED}"`,
    `export DATABASE_URL_UNPOOLED='${NEON_DIRECT}'`,
    'NEON_BRANCH=production # comment',
    'not a line',
    '',
  ].join('\n'));
  assert.deepEqual(parsed, {
    DATABASE_URL: NEON_POOLED,
    DATABASE_URL_UNPOOLED: NEON_DIRECT,
    NEON_BRANCH: 'production',
  });
});

test('.env.local loads first, .env fills gaps, real environment always wins', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pantry-env-'));
  try {
    fs.writeFileSync(path.join(root, '.env.local'), 'DATABASE_URL=from-local\nSESSION_SECRET=local-secret\n');
    fs.writeFileSync(path.join(root, '.env'), 'DATABASE_URL=from-dotenv\nPORT=4000\n');
    const env = { SESSION_SECRET: 'from-render' };
    assert.deepEqual(loadEnvFiles({ root, env }), ['.env.local', '.env']);
    assert.equal(env.DATABASE_URL, 'from-local');
    assert.equal(env.PORT, '4000');
    assert.equal(env.SESSION_SECRET, 'from-render');

    assert.deepEqual(loadEnvFiles({ root, env: { PANTRY_SKIP_ENV_FILES: '1' } }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('env files with secrets are git-ignored and neon.ts is committed config', () => {
  const ignore = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
  assert.match(ignore, /^\.env\.\*$/m);
  assert.match(ignore, /^\.env$/m);
  assert.match(ignore, /^\.neon$/m);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'neon.ts')));
});

test('a real DATABASE_URL keeps .env.local from supplying a different migration URL', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pantry-env-'));
  try {
    fs.writeFileSync(path.join(root, '.env.local'), `DATABASE_URL=${NEON_POOLED}\nDATABASE_URL_UNPOOLED=${NEON_DIRECT}\nNEON_BRANCH=production\n`);
    const env = { DATABASE_URL: 'postgres://postgres@localhost:5433/pantry' };
    loadEnvFiles({ root, env });
    assert.equal(env.DATABASE_URL, 'postgres://postgres@localhost:5433/pantry');
    assert.equal(env.DATABASE_URL_UNPOOLED, undefined);
    assert.equal(migrationDatabaseUrl(env), 'postgres://postgres@localhost:5433/pantry');
    assert.equal(env.NEON_BRANCH, 'production');

    const fromFile = {};
    loadEnvFiles({ root, env: fromFile });
    assert.equal(migrationDatabaseUrl(fromFile), NEON_DIRECT);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
