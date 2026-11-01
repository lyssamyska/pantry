const { pool } = require('./index');

async function createPendingCheckout({
  userId,
  checkoutSessionId,
  offeringKey,
  offeringName,
  amountUsd,
  interval,
}, database = pool) {
  const inserted = await database.query(
    `INSERT INTO pantry_payment_checkouts
       (user_id, checkout_session_id, offering_key, offering_name, amount_usd, interval, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     ON CONFLICT (checkout_session_id) DO NOTHING
     RETURNING *`,
    [userId, checkoutSessionId, offeringKey, offeringName, amountUsd, interval]
  );
  if (inserted.rows[0]) return inserted.rows[0];

  const existing = await database.query(
    `SELECT * FROM pantry_payment_checkouts
     WHERE checkout_session_id = $1 AND user_id = $2`,
    [checkoutSessionId, userId]
  );
  return existing.rows[0] || null;
}

async function getPendingCheckout(checkoutSessionId, userId, database = pool) {
  const result = await database.query(
    `SELECT * FROM pantry_payment_checkouts
     WHERE checkout_session_id = $1 AND user_id = $2
     LIMIT 1`,
    [checkoutSessionId, userId]
  );
  return result.rows[0] || null;
}

async function getPaidEntitlement(userId, offeringKey, database = pool) {
  const result = await database.query(
    `SELECT * FROM pantry_paid_entitlements
     WHERE user_id = $1 AND offering_key = $2
     LIMIT 1`,
    [userId, offeringKey]
  );
  return result.rows[0] || null;
}

async function hasPaidEntitlement(userId, offeringKey, database = pool) {
  return Boolean(await getPaidEntitlement(userId, offeringKey, database));
}

async function fulfillVerifiedCheckout({
  checkoutSessionId,
  userId,
  verified,
  database = pool,
}) {
  if (verified !== true) return { fulfilled: false, accessGranted: false, reason: 'not_verified' };

  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const checkoutResult = await client.query(
      `SELECT * FROM pantry_payment_checkouts
       WHERE checkout_session_id = $1 AND user_id = $2
       FOR UPDATE`,
      [checkoutSessionId, userId]
    );
    const checkout = checkoutResult.rows[0];
    if (!checkout) {
      await client.query('ROLLBACK');
      return { fulfilled: false, accessGranted: false, reason: 'checkout_not_found' };
    }

    if (checkout.status !== 'fulfilled') {
      await client.query(
        `INSERT INTO pantry_paid_entitlements
           (user_id, offering_key, offering_name, amount_usd, interval, checkout_session_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, offering_key) DO NOTHING`,
        [checkout.user_id, checkout.offering_key, checkout.offering_name, checkout.amount_usd, checkout.interval, checkout.checkout_session_id]
      );
      await client.query(
        `UPDATE pantry_payment_checkouts
         SET status = 'fulfilled', verified_at = COALESCE(verified_at, NOW()), fulfilled_at = COALESCE(fulfilled_at, NOW()), updated_at = NOW()
         WHERE checkout_session_id = $1 AND user_id = $2`,
        [checkoutSessionId, userId]
      );
    }

    const entitlementResult = await client.query(
      `SELECT * FROM pantry_paid_entitlements
       WHERE user_id = $1 AND offering_key = $2
       LIMIT 1`,
      [userId, checkout.offering_key]
    );
    await client.query('COMMIT');
    return {
      fulfilled: checkout.status === 'fulfilled' || entitlementResult.rows.length > 0,
      accessGranted: entitlementResult.rows.length > 0,
      entitlement: entitlementResult.rows[0] || null,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  createPendingCheckout,
  fulfillVerifiedCheckout,
  getPaidEntitlement,
  getPendingCheckout,
  hasPaidEntitlement,
};
