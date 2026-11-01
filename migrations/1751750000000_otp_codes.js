module.exports = {
  name: 'otp_codes',
  up: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS otp_codes (
        id         SERIAL PRIMARY KEY,
        email      VARCHAR(255) NOT NULL,
        code       CHAR(6)      NOT NULL,
        expires_at TIMESTAMPTZ  NOT NULL,
        used       BOOLEAN      NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_otp_codes_email ON otp_codes (LOWER(email))`
    );
  },
};
