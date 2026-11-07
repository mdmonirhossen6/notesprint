import { transaction, type Database } from './database.js';
import { migration001 } from './migrations/001_init.js';
import { migration002 } from './migrations/002_channels.js';
import { nowSeconds } from '../lib/time.js';

interface Migration {
  id: number;
  name: string;
  sql: string;
}

const MIGRATIONS: readonly Migration[] = [migration001, migration002];

export function migrate(db: Database): { applied: number } {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);

  const rows = db.prepare('SELECT id FROM schema_migrations').all() as Array<{ id: number }>;
  const appliedIds = new Set(rows.map((row) => row.id));
  let applied = 0;

  for (const migration of MIGRATIONS) {
    if (appliedIds.has(migration.id)) continue;
    transaction(db, () => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(
        migration.id,
        migration.name,
        nowSeconds(),
      );
    });
    applied += 1;
  }

  return { applied };
}
