// Postgres connection settings for Neon (and local Postgres in development).
//
// Pantry runs as a long-lived Express server (Render), so it uses node-postgres
// (`pg`) with a connection pool — Neon's recommendation for long-running Node
// servers. Two URLs, matching what `neon env pull` writes:
//   DATABASE_URL           pooled (-pooler) endpoint — normal app queries
//   DATABASE_URL_UNPOOLED  direct endpoint — migrations (falls back to DATABASE_URL)

function isLocalDatabase(url) {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '';
  } catch {
    return false;
  }
}

function hasParam(url, name, value) {
  try {
    return new URL(url).searchParams.get(name) === value;
  } catch {
    return false;
  }
}

// Pool options for a connection string. Remote databases always use verified
// TLS; `channel_binding=require` (in Neon's connection strings) turns on
// SCRAM-SHA-256-PLUS, which pg does not read from the URL by itself.
function poolConfig(url, { max = 10 } = {}) {
  const base = { max, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 15_000 };
  // No URL: build the pool anyway so modules load (tests); queries fail until one is set.
  if (!url) return base;
  const local = isLocalDatabase(url) || hasParam(url, 'sslmode', 'disable');
  return {
    connectionString: url,
    ssl: local ? false : true,
    enableChannelBinding: !local && hasParam(url, 'channel_binding', 'require'),
    // Neon computes scale to zero; the first connection after idle can take a few seconds,
    // hence the 15s connection timeout in `base`.
    ...base,
  };
}

function appDatabaseUrl(env = process.env) {
  return env.DATABASE_URL;
}

function migrationDatabaseUrl(env = process.env) {
  return env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
}

module.exports = { isLocalDatabase, poolConfig, appDatabaseUrl, migrationDatabaseUrl };
