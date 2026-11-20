// Loads .env.local then .env for local development (`neon env pull` writes
// DATABASE_URL / DATABASE_URL_UNPOOLED there). Variables already set in the
// real environment — e.g. on Render — always win; files never override them.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadEnvFiles({ root = ROOT, files = ['.env.local', '.env'], env = process.env } = {}) {
  if (env.PANTRY_SKIP_ENV_FILES === '1') return []; // used by tests that check missing-variable errors
  const loaded = [];
  for (const name of files) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    const parsed = parseEnvFile(fs.readFileSync(file, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (env[key] === undefined) env[key] = value;
    }
    loaded.push(name);
  }
  return loaded;
}

// Minimal dotenv parser: KEY=value, optional `export`, quotes, # comments.
function parseEnvFile(text) {
  const result = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2];
    if (/^"(.*)"$/s.test(value)) value = value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"');
    else if (/^'(.*)'$/s.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '').trim();
    result[match[1]] = value;
  }
  return result;
}

module.exports = { loadEnvFiles, parseEnvFile };
