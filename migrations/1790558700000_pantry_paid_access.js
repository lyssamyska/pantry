module.exports = {
  name: 'pantry_paid_access',
  up: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS pantry_payment_checkouts (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        checkout_session_id VARCHAR(255) NOT NULL,
        offering_key VARCHAR(512) NOT NULL,
        offering_name VARCHAR(255) NOT NULL,
        amount_usd NUMERIC(10, 2) NOT NULL,
        interval VARCHAR(20) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        verified_at TIMESTAMPTZ,
        fulfilled_at TIMESTAMPTZ
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS pantry_paid_entitlements (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        offering_key VARCHAR(512) NOT NULL,
        offering_name VARCHAR(255) NOT NULL,
        amount_usd NUMERIC(10, 2) NOT NULL,
        interval VARCHAR(20) NOT NULL,
        checkout_session_id VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS pantry_payment_checkouts_session_idx
      ON pantry_payment_checkouts (checkout_session_id)
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS pantry_paid_entitlements_user_offering_idx
      ON pantry_paid_entitlements (user_id, offering_key)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS pantry_payment_checkouts_user_idx
      ON pantry_payment_checkouts (user_id, created_at DESC)
    `);
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'pantry_payment_checkouts_interval_check'
        ) THEN
          ALTER TABLE pantry_payment_checkouts
          ADD CONSTRAINT pantry_payment_checkouts_interval_check
          CHECK (interval IN ('one_time', 'month', 'year'));
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'pantry_payment_checkouts_status_check'
        ) THEN
          ALTER TABLE pantry_payment_checkouts
          ADD CONSTRAINT pantry_payment_checkouts_status_check
          CHECK (status IN ('pending', 'verified', 'fulfilled'));
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'pantry_paid_entitlements_interval_check'
        ) THEN
          ALTER TABLE pantry_paid_entitlements
          ADD CONSTRAINT pantry_paid_entitlements_interval_check
          CHECK (interval IN ('one_time', 'month', 'year'));
        END IF;
      END $$;
    `);
  },
};
