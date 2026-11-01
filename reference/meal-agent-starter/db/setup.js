// ═══════════════════════════════════════════════════════
// Database Setup Script
// Run with: npm run db:setup
// Creates meal agent tables in your WordPress database
// ═══════════════════════════════════════════════════════

const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env.local' });

const PREFIX = (process.env.WORDPRESS_TABLE_PREFIX || 'wp_') + 'ma_';

async function setup() {
  const connection = await mysql.createConnection({
    host: process.env.WORDPRESS_DB_HOST || 'localhost',
    port: parseInt(process.env.WORDPRESS_DB_PORT || '3306'),
    database: process.env.WORDPRESS_DB_NAME,
    user: process.env.WORDPRESS_DB_USER,
    password: process.env.WORDPRESS_DB_PASSWORD,
  });

  console.log('Connected to WordPress database.');
  console.log(`Creating tables with prefix: ${PREFIX}\n`);

  const tables = [
    // Users (separate from WP users — email/password auth)
    `CREATE TABLE IF NOT EXISTS ${PREFIX}users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      display_name VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Recipes
    `CREATE TABLE IF NOT EXISTS ${PREFIX}recipes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      name VARCHAR(500) NOT NULL,
      source ENUM('manual','pinterest','url','paprika','mealime','plantoeat') DEFAULT 'manual',
      source_url TEXT,
      protein ENUM('beef','chicken','fish','turkey') DEFAULT NULL,
      total_time_minutes INT DEFAULT 30,
      servings INT DEFAULT 4,
      ingredients JSON NOT NULL,
      instructions JSON,
      tags JSON,
      compliant BOOLEAN DEFAULT TRUE,
      warnings JSON,
      schema_org_json JSON COMMENT 'Original schema.org/Recipe data',
      image_url TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES ${PREFIX}users(id) ON DELETE CASCADE,
      INDEX idx_user (user_id),
      INDEX idx_compliant (user_id, compliant),
      FULLTEXT idx_search (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Pantry items
    `CREATE TABLE IF NOT EXISTS ${PREFIX}pantry (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      name VARCHAR(255) NOT NULL,
      quantity VARCHAR(100),
      category VARCHAR(100) DEFAULT 'other',
      expires_at DATE DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES ${PREFIX}users(id) ON DELETE CASCADE,
      INDEX idx_user (user_id),
      INDEX idx_expires (user_id, expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Meal plans
    `CREATE TABLE IF NOT EXISTS ${PREFIX}meal_plans (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      week_start DATE NOT NULL,
      day_of_week TINYINT NOT NULL COMMENT '0=Mon, 6=Sun',
      meal ENUM('Breakfast','Lunch','Dinner') NOT NULL,
      recipe_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES ${PREFIX}users(id) ON DELETE CASCADE,
      FOREIGN KEY (recipe_id) REFERENCES ${PREFIX}recipes(id) ON DELETE CASCADE,
      UNIQUE KEY uk_slot (user_id, week_start, day_of_week, meal),
      INDEX idx_user_week (user_id, week_start)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Deals cache
    `CREATE TABLE IF NOT EXISTS ${PREFIX}deals (
      id INT AUTO_INCREMENT PRIMARY KEY,
      source VARCHAR(50) NOT NULL,
      store VARCHAR(100),
      item VARCHAR(500) NOT NULL,
      price VARCHAR(100),
      savings VARCHAR(100),
      compliant BOOLEAN DEFAULT TRUE,
      warning TEXT,
      expires_at DATE,
      scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_compliant (compliant, expires_at),
      INDEX idx_source (source)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Pinterest auth tokens (per user)
    `CREATE TABLE IF NOT EXISTS ${PREFIX}pinterest_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL UNIQUE,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      expires_at TIMESTAMP,
      scope VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES ${PREFIX}users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ];

  for (const sql of tables) {
    const tableName = sql.match(/CREATE TABLE IF NOT EXISTS (\S+)/)?.[1];
    try {
      await connection.execute(sql);
      console.log(`  ✅ ${tableName}`);
    } catch (err) {
      console.error(`  ❌ ${tableName}: ${err.message}`);
    }
  }

  console.log('\nDone! Meal Agent tables created in your WordPress database.');
  console.log(`Tables are prefixed with "${PREFIX}" to avoid conflicts.\n`);

  await connection.end();
}

setup().catch(err => {
  console.error('Setup failed:', err);
  process.exit(1);
});
