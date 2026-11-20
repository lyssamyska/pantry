// Pantry no longer uses Polsia: sign-in is email + password (users.password_hash)
// and there is no paid tier. Drop the one-time-code table, the payment tables,
// and the Stripe subscription columns Polsia used to sync.
module.exports = {
  name: 'remove_polsia_auth_and_payments',
  up: async (client) => {
    await client.query('DROP TABLE IF EXISTS otp_codes');
    await client.query('DROP TABLE IF EXISTS pantry_paid_entitlements');
    await client.query('DROP TABLE IF EXISTS pantry_payment_checkouts');
    await client.query('DROP INDEX IF EXISTS users_stripe_subscription_id_idx');
    await client.query(`
      ALTER TABLE users
      DROP COLUMN IF EXISTS stripe_subscription_id,
      DROP COLUMN IF EXISTS subscription_status,
      DROP COLUMN IF EXISTS subscription_plan,
      DROP COLUMN IF EXISTS subscription_expires_at,
      DROP COLUMN IF EXISTS subscription_updated_at
    `);
  },
};
