import mysql from 'mysql2/promise';

// ═══════════════════════════════════════════════════════
// WordPress Database Connection
// Uses your existing WP MySQL database with custom tables
// prefixed as wp_ma_ (meal agent) to avoid conflicts
// ═══════════════════════════════════════════════════════

const pool = mysql.createPool({
  host: process.env.WORDPRESS_DB_HOST || 'localhost',
  port: parseInt(process.env.WORDPRESS_DB_PORT || '3306'),
  database: process.env.WORDPRESS_DB_NAME,
  user: process.env.WORDPRESS_DB_USER,
  password: process.env.WORDPRESS_DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

const PREFIX = (process.env.WORDPRESS_TABLE_PREFIX || 'wp_') + 'ma_';

export function table(name: string) {
  return `${PREFIX}${name}`;
}

export async function query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const [rows] = await pool.execute(sql, params);
  return rows as T[];
}

export async function queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] || null;
}

export async function insert(tableName: string, data: Record<string, any>): Promise<number> {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const placeholders = keys.map(() => '?').join(', ');
  const sql = `INSERT INTO ${table(tableName)} (${keys.join(', ')}) VALUES (${placeholders})`;
  const [result] = await pool.execute(sql, values) as any;
  return result.insertId;
}

export async function update(
  tableName: string,
  data: Record<string, any>,
  where: string,
  whereParams: any[]
): Promise<number> {
  const sets = Object.keys(data).map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(data), ...whereParams];
  const sql = `UPDATE ${table(tableName)} SET ${sets} WHERE ${where}`;
  const [result] = await pool.execute(sql, values) as any;
  return result.affectedRows;
}

export async function remove(tableName: string, where: string, params: any[]): Promise<number> {
  const sql = `DELETE FROM ${table(tableName)} WHERE ${where}`;
  const [result] = await pool.execute(sql, params) as any;
  return result.affectedRows;
}

export default pool;
