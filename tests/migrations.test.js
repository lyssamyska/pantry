const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'migrations');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();

test('every migration exports a unique name and an up() function', () => {
  const names = new Set();
  for (const file of files) {
    const migration = require(path.join(dir, file));
    assert.equal(typeof migration.name, 'string', file);
    assert.equal(typeof migration.up, 'function', file);
    assert.ok(!names.has(migration.name), `duplicate migration name ${migration.name}`);
    names.add(migration.name);
  }
});

test('Polsia/payment cleanup runs after the tables it drops were created', () => {
  const cleanup = files.indexOf('1790600000000_remove_polsia_auth_and_payments.js');
  assert.ok(cleanup > files.indexOf('1751750000000_otp_codes.js'));
  assert.ok(cleanup > files.indexOf('1790558700000_pantry_paid_access.js'));
  const migrate = fs.readFileSync(path.join(__dirname, '..', 'migrate.js'), 'utf8');
  assert.doesNotMatch(migrate, /stripe_subscription_id/, 'core migration must not re-create dropped columns');
});

test('the first migration creates tables only (its JSONB seed broke fresh databases)', async () => {
  const sql = [];
  await require(path.join(dir, '1751656500000_seed_recipes_and_plan_tables.js')).up({
    async query(text) { sql.push(text); return { rows: [] }; },
  });
  assert.ok(sql.some((s) => /CREATE TABLE IF NOT EXISTS recipes/.test(s)));
  assert.ok(!sql.some((s) => /INSERT INTO recipes/.test(s)));
});

test('seed recipes are inserted as JSON text, which Postgres JSONB accepts', async () => {
  const inserts = [];
  await require(path.join(dir, '1751657000000_seed_recipes.js')).up({
    async query(text, params) { if (/INSERT INTO recipes/.test(text)) inserts.push(params); return { rows: [] }; },
  });
  assert.ok(inserts.length > 40);
  for (const params of inserts) {
    assert.equal(typeof params[7], 'string');
    assert.ok(Array.isArray(JSON.parse(params[7])));
  }
});

test('Discover queries alias recipes as r (the curated bucket used to 500)', async () => {
  const { pool } = require('../db/index');
  const { getDiscoveryRecipes } = require('../db/recipes');
  const original = pool.query;
  const seen = [];
  pool.query = async (text) => { seen.push(text); return { rows: [] }; };
  try {
    await getDiscoveryRecipes(null);
    await getDiscoveryRecipes(5);
  } finally {
    pool.query = original;
  }
  for (const text of seen.filter((s) => /r\.id, r\.name/.test(s))) {
    assert.match(text, /FROM (?:recipes r|user_bookmarks ub\s+JOIN recipes r)\b/, text);
  }
});
