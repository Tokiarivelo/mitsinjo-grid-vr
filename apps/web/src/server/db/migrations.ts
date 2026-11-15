/**
 * Neon schema migrations, applied automatically: on the first database call of each server
 * instance (`neon.ts`) and by `make db-migrate`. Applied ids are recorded in `schema_migrations`.
 *
 * Rules: append a new migration for every change to a stored shape; never edit or reorder one
 * that has shipped. Statements stay idempotent (IF NOT EXISTS) so two instances starting at the
 * same time, or a database created before this file existed, migrate safely.
 *
 * No `server-only` import here: the CLI script and the tests load this file directly.
 */

export interface Migration {
  /** `NNNN_snake_case`, strictly increasing. */
  id: string;
  statements: readonly string[];
}

/** Runs one SQL statement (optional `$1…` params) and returns its rows. */
export type SqlExec = (text: string, params?: unknown[]) => Promise<unknown[]>;

export const MIGRATIONS: readonly Migration[] = [
  {
    id: '0001_copilot_sessions',
    statements: [
      `CREATE TABLE IF NOT EXISTS copilot_sessions (
        id VARCHAR(64) PRIMARY KEY,
        title TEXT NOT NULL,
        locale VARCHAR(8) DEFAULT 'en',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS copilot_messages (
        id VARCHAR(64) PRIMARY KEY,
        session_id VARCHAR(64) REFERENCES copilot_sessions(id) ON DELETE CASCADE,
        role VARCHAR(16) NOT NULL,
        content TEXT NOT NULL,
        media JSONB,
        chart JSONB,
        sections JSONB,
        evidence JSONB,
        proposal JSONB,
        detected_model VARCHAR(64),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
    ],
  },
  {
    id: '0002_message_decision',
    statements: ['ALTER TABLE copilot_messages ADD COLUMN IF NOT EXISTS decision JSONB'],
  },
  {
    id: '0003_session_summary',
    statements: [
      'ALTER TABLE copilot_sessions ADD COLUMN IF NOT EXISTS summary TEXT',
      'ALTER TABLE copilot_sessions ADD COLUMN IF NOT EXISTS summarized_count INT DEFAULT 0',
    ],
  },
  {
    id: '0004_dispatch_log',
    statements: [
      `CREATE TABLE IF NOT EXISTS dispatch_log (
        id VARCHAR(64) PRIMARY KEY,
        day INT NOT NULL,
        hour INT NOT NULL,
        mode VARCHAR(16) NOT NULL,
        origin VARCHAR(16) NOT NULL,
        incident JSONB,
        action JSONB,
        "before" JSONB,
        "after" JSONB,
        narration JSONB,
        hash VARCHAR(64) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      'CREATE INDEX IF NOT EXISTS idx_dispatch_log_created_at ON dispatch_log (created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_dispatch_log_day_hour ON dispatch_log (day, hour)',
    ],
  },
  {
    id: '0005_scenario_drafts',
    statements: [
      `CREATE TABLE IF NOT EXISTS scenario_drafts (
        id VARCHAR(64) PRIMARY KEY,
        title TEXT NOT NULL,
        draft JSONB NOT NULL,
        summary JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      'CREATE INDEX IF NOT EXISTS idx_scenario_drafts_created_at ON scenario_drafts (created_at DESC)',
      'ALTER TABLE copilot_messages ADD COLUMN IF NOT EXISTS scenario_draft JSONB',
    ],
  },
  {
    id: '0006_shape_step_models',
    statements: [
      `CREATE TABLE IF NOT EXISTS shape_step_models (
        scope VARCHAR(128) PRIMARY KEY,
        models JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
    ],
  },
];

const ID_PATTERN = /^\d{4}_[a-z0-9_]+$/;

/** Throws when ids are malformed, duplicated or out of order (checked in tests and before running). */
export function assertMigrationsValid(migrations: readonly Migration[]): void {
  migrations.forEach((m, i) => {
    if (!ID_PATTERN.test(m.id)) throw new Error(`Bad migration id: ${m.id}`);
    if (m.statements.length === 0) throw new Error(`Empty migration: ${m.id}`);
    const prev = migrations[i - 1];
    if (prev && prev.id >= m.id) throw new Error(`Migration out of order: ${m.id}`);
  });
}

/**
 * Applies the pending migrations in order and returns their ids (empty = already up to date).
 * A failing statement stops the run: later migrations wait for the next attempt.
 */
export async function runMigrations(
  exec: SqlExec,
  migrations: readonly Migration[] = MIGRATIONS
): Promise<string[]> {
  assertMigrationsValid(migrations);
  await exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(128) PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )`
  );
  const rows = (await exec('SELECT id FROM schema_migrations')) as { id: string }[];
  const done = new Set(rows.map((r) => r.id));
  const applied: string[] = [];
  for (const m of migrations) {
    if (done.has(m.id)) continue;
    for (const statement of m.statements) await exec(statement);
    await exec('INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [
      m.id,
    ]);
    applied.push(m.id);
  }
  return applied;
}
