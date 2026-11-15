import 'server-only';
import { neon } from '@neondatabase/serverless';
import { env } from '@/lib/env';
import { runMigrations } from './migrations';
import { preferIpv4Fetch } from './ipv4-fetch';
import type {
  ChatSessionSummary,
  ChatSessionDetail,
  ChatMessageData,
} from '@/features/copilot/types';
import type { DispatchLogEntry } from '@mitsinjo/engine';
import type { ScenarioDraft } from '@/lib/scenario-draft';
import { StepModelsSelectionSchema, type StepModelsSelection } from '@/lib/step-models';

preferIpv4Fetch();

// In-memory fallback stores when DATABASE_URL is not configured
const inMemorySessions = new Map<string, ChatSessionSummary>();
const inMemoryMessages = new Map<string, ChatMessageData[]>();
const inMemorySummaries = new Map<string, SessionSummaryNote>();
const inMemoryDispatchLog: DispatchLogEntry[] = [];
const inMemoryScenarioDrafts = new Map<string, SavedScenarioDraft>();
const inMemoryStepModels = new Map<string, StepModelsSelection>();

export interface SavedScenarioDraft {
  id: string;
  title: string;
  draft: ScenarioDraft;
  summary?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** Conversation summary of a session: text + how many payload messages it covers. */
export interface SessionSummaryNote {
  summary: string;
  summarizedCount: number;
}

let isMigrated = false;

export function isNeonConfigured(): boolean {
  return Boolean(env.DATABASE_URL);
}

/** Applies pending schema migrations once per server instance (see `migrations.ts`). */
async function ensureNeonTables(sql: ReturnType<typeof neon<false, false>>) {
  if (isMigrated) return;
  try {
    const applied = await runMigrations((text, params) => sql.query(text, params ?? []));
    isMigrated = true;
    if (applied.length > 0) console.info(`[db:neon] Applied migrations: ${applied.join(', ')}`);
  } catch (err) {
    console.error('[db:neon] Failed to apply migrations:', err);
  }
}

export async function listSessions(): Promise<ChatSessionSummary[]> {
  if (!isNeonConfigured()) {
    return Array.from(inMemorySessions.values()).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  const sql = neon(env.DATABASE_URL!);
  await ensureNeonTables(sql);

  const rows = await sql`
    SELECT 
      s.id, 
      s.title, 
      s.locale, 
      s.created_at as "createdAt", 
      s.updated_at as "updatedAt",
      COUNT(m.id)::int as "messageCount"
    FROM copilot_sessions s
    LEFT JOIN copilot_messages m ON s.id = m.session_id
    GROUP BY s.id
    ORDER BY s.updated_at DESC
    LIMIT 50;
  `;

  return rows as unknown as ChatSessionSummary[];
}

export async function getSession(id: string): Promise<ChatSessionDetail | null> {
  if (!isNeonConfigured()) {
    const summary = inMemorySessions.get(id);
    if (!summary) return null;
    const msgs = inMemoryMessages.get(id) || [];
    return { ...summary, ...inMemorySummaries.get(id), messages: msgs };
  }

  const sql = neon(env.DATABASE_URL!);
  await ensureNeonTables(sql);

  const sessionRows = await sql`
    SELECT id, title, locale, created_at as "createdAt", updated_at as "updatedAt",
      summary, summarized_count as "summarizedCount"
    FROM copilot_sessions
    WHERE id = ${id}
    LIMIT 1;
  `;

  if (sessionRows.length === 0) return null;
  const row = sessionRows[0] as unknown as ChatSessionSummary & {
    summary: string | null;
    summarizedCount: number | null;
  };
  const session = {
    ...row,
    summary: row.summary ?? undefined,
    summarizedCount: row.summarizedCount ?? 0,
  };

  const msgRows = await sql`
    SELECT 
      id,
      role,
      content,
      media,
      chart,
      sections,
      evidence,
      proposal,
      decision,
      scenario_draft as "scenarioDraft",
      detected_model as "detectedModel",
      created_at as "timestamp"
    FROM copilot_messages
    WHERE session_id = ${id}
    ORDER BY created_at ASC;
  `;

  return {
    ...session,
    messages: msgRows as unknown as ChatMessageData[],
  };
}

export async function createSession(
  title?: string,
  locale = 'fr',
  id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
): Promise<ChatSessionSummary> {
  const now = new Date().toISOString();
  const sessionTitle = title || (locale === 'fr' ? 'Session de simulation' : 'Simulation session');

  const session: ChatSessionSummary = {
    id,
    title: sessionTitle,
    locale,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  };

  if (!isNeonConfigured()) {
    inMemorySessions.set(id, session);
    inMemoryMessages.set(id, []);
    return session;
  }

  const sql = neon(env.DATABASE_URL!);
  await ensureNeonTables(sql);

  await sql`
    INSERT INTO copilot_sessions (id, title, locale, created_at, updated_at)
    VALUES (${id}, ${sessionTitle}, ${locale}, ${now}, ${now});
  `;

  return session;
}

export async function saveMessage(sessionId: string, message: ChatMessageData): Promise<void> {
  const now = new Date().toISOString();

  if (!isNeonConfigured()) {
    if (!inMemorySessions.has(sessionId)) {
      await createSession(message.content.slice(0, 50) || undefined, 'fr', sessionId);
    }
    const msgs = inMemoryMessages.get(sessionId) || [];
    msgs.push(message);
    inMemoryMessages.set(sessionId, msgs);

    const s = inMemorySessions.get(sessionId);
    if (s) {
      s.updatedAt = now;
      s.messageCount = msgs.length;
    }
    return;
  }

  const sql = neon(env.DATABASE_URL!);
  await ensureNeonTables(sql);

  // Ensure session exists
  await sql`
    INSERT INTO copilot_sessions (id, title, created_at, updated_at)
    VALUES (${sessionId}, ${message.content.slice(0, 50) || 'Simulation session'}, ${now}, ${now})
    ON CONFLICT (id) DO UPDATE SET updated_at = ${now};
  `;

  await sql`
    INSERT INTO copilot_messages (
      id,
      session_id,
      role,
      content,
      media,
      chart,
      sections,
      evidence,
      proposal,
      decision,
      scenario_draft,
      detected_model,
      created_at
    ) VALUES (
      ${message.id},
      ${sessionId},
      ${message.role},
      ${message.content || ''},
      ${message.media ? JSON.stringify(message.media) : null},
      ${message.chart ? JSON.stringify(message.chart) : null},
      ${message.sections ? JSON.stringify(message.sections) : null},
      ${message.evidence ? JSON.stringify(message.evidence) : null},
      ${message.proposal ? JSON.stringify(message.proposal) : null},
      ${message.decision ? JSON.stringify(message.decision) : null},
      ${message.scenarioDraft ? JSON.stringify(message.scenarioDraft) : null},
      ${message.detectedModel || null},
      ${now}
    )
    ON CONFLICT (id) DO UPDATE SET
      content = ${message.content || ''},
      sections = ${message.sections ? JSON.stringify(message.sections) : null},
      evidence = ${message.evidence ? JSON.stringify(message.evidence) : null},
      proposal = ${message.proposal ? JSON.stringify(message.proposal) : null},
      chart = ${message.chart ? JSON.stringify(message.chart) : null},
      scenario_draft = ${message.scenarioDraft ? JSON.stringify(message.scenarioDraft) : null};
  `;
}

/** Stores the session's conversation summary (auto-compaction); the session must exist. */
export async function saveSessionSummary(sessionId: string, note: SessionSummaryNote) {
  if (!isNeonConfigured()) {
    inMemorySummaries.set(sessionId, note);
    return;
  }
  const sql = neon(env.DATABASE_URL!);
  await ensureNeonTables(sql);
  await sql`
    INSERT INTO copilot_sessions (id, title, summary, summarized_count)
    VALUES (${sessionId}, 'Simulation session', ${note.summary}, ${note.summarizedCount})
    ON CONFLICT (id) DO UPDATE SET summary = ${note.summary}, summarized_count = ${note.summarizedCount};
  `;
}

export async function deleteSession(id: string): Promise<boolean> {
  if (!isNeonConfigured()) {
    inMemoryMessages.delete(id);
    inMemorySummaries.delete(id);
    return inMemorySessions.delete(id);
  }

  const sql = neon(env.DATABASE_URL!);
  await ensureNeonTables(sql);

  await sql`
    DELETE FROM copilot_sessions WHERE id = ${id};
  `;
  return true;
}

/** Stores dispatch log lines (an existing id only gets its narration updated). */
export async function saveDispatchLogEntries(entries: readonly DispatchLogEntry[]): Promise<void> {
  if (!isNeonConfigured()) {
    for (const entry of entries) {
      const idx = inMemoryDispatchLog.findIndex((e) => e.id === entry.id);
      if (idx >= 0) inMemoryDispatchLog[idx] = entry;
      else inMemoryDispatchLog.push(entry);
    }
    return;
  }

  const sql = neon(env.DATABASE_URL!);
  await ensureNeonTables(sql);
  const json = (v: unknown) => (v ? JSON.stringify(v) : null);
  for (const entry of entries) {
    await sql`
      INSERT INTO dispatch_log (
        id, day, hour, mode, origin, incident, action, "before", "after", narration, hash
      ) VALUES (
        ${entry.id}, ${entry.day}, ${entry.hour}, ${entry.mode}, ${entry.origin},
        ${json(entry.incident)}, ${json(entry.action)}, ${json(entry.before)},
        ${json(entry.after)}, ${json(entry.narration)}, ${entry.hash}
      )
      ON CONFLICT (id) DO UPDATE SET narration = EXCLUDED.narration;
    `;
  }
}

/** The latest `limit` log lines, oldest first. */
export async function listDispatchLog(limit = 100): Promise<DispatchLogEntry[]> {
  if (!isNeonConfigured()) {
    return inMemoryDispatchLog.slice(-limit);
  }

  const sql = neon(env.DATABASE_URL!);
  await ensureNeonTables(sql);

  const rows = await sql`
    SELECT * FROM (
      SELECT id, day, hour, mode, origin, incident, action, "before", "after", narration, hash,
        created_at
      FROM dispatch_log
      ORDER BY created_at DESC
      LIMIT ${limit}
    ) latest
    ORDER BY created_at ASC;
  `;

  return rows.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    day: Number(r.day),
    hour: Number(r.hour),
    mode: r.mode as DispatchLogEntry['mode'],
    origin: r.origin as DispatchLogEntry['origin'],
    incident: (r.incident as DispatchLogEntry['incident']) ?? undefined,
    action: (r.action as DispatchLogEntry['action']) ?? undefined,
    before: (r.before as DispatchLogEntry['before']) ?? undefined,
    after: (r.after as DispatchLogEntry['after']) ?? undefined,
    narration: (r.narration as DispatchLogEntry['narration']) ?? undefined,
    hash: r.hash as string,
  }));
}

export async function clearDispatchLog(): Promise<void> {
  if (!isNeonConfigured()) {
    inMemoryDispatchLog.length = 0;
    return;
  }

  const sql = neon(env.DATABASE_URL!);
  await ensureNeonTables(sql);
  await sql`DELETE FROM dispatch_log;`;
}

export async function saveScenarioDraft(
  draft: ScenarioDraft,
  title?: string,
  summary?: Record<string, unknown>
): Promise<string> {
  const id = draft.id || `draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const draftTitle = title || draft.title || `Scenario (${draft.days.length} days)`;
  const now = new Date().toISOString();

  if (!isNeonConfigured()) {
    inMemoryScenarioDrafts.set(id, {
      id,
      title: draftTitle,
      draft: { ...draft, id, title: draftTitle },
      summary,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  const sql = neon(env.DATABASE_URL!);
  await ensureNeonTables(sql);

  await sql`
    INSERT INTO scenario_drafts (id, title, draft, summary, created_at, updated_at)
    VALUES (
      ${id},
      ${draftTitle},
      ${JSON.stringify({ ...draft, id, title: draftTitle })},
      ${summary ? JSON.stringify(summary) : null},
      ${now},
      ${now}
    )
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      draft = EXCLUDED.draft,
      summary = EXCLUDED.summary,
      updated_at = EXCLUDED.updated_at;
  `;

  return id;
}

export async function listScenarioDrafts(): Promise<SavedScenarioDraft[]> {
  if (!isNeonConfigured()) {
    return Array.from(inMemoryScenarioDrafts.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  const sql = neon(env.DATABASE_URL!);
  await ensureNeonTables(sql);

  const rows = await sql`
    SELECT id, title, draft, summary, created_at as "createdAt", updated_at as "updatedAt"
    FROM scenario_drafts
    ORDER BY created_at DESC
    LIMIT 50;
  `;

  return rows as unknown as SavedScenarioDraft[];
}

export async function deleteScenarioDraft(id: string): Promise<boolean> {
  if (!isNeonConfigured()) {
    return inMemoryScenarioDrafts.delete(id);
  }

  const sql = neon(env.DATABASE_URL!);
  await ensureNeonTables(sql);
  await sql`DELETE FROM scenario_drafts WHERE id = ${id};`;
  return true;
}

/** Operator's per-step 3D model choice (`shape_step_models`); null = env defaults everywhere. */
export async function getShapeStepModels(scope: string): Promise<StepModelsSelection | null> {
  if (!isNeonConfigured()) return inMemoryStepModels.get(scope) ?? null;
  const sql = neon(env.DATABASE_URL!);
  await ensureNeonTables(sql);
  const rows = await sql`
    SELECT models FROM shape_step_models WHERE scope = ${scope} LIMIT 1;
  `;
  if (!rows || rows.length === 0) return null;
  const parsed = StepModelsSelectionSchema.safeParse((rows[0] as { models: unknown }).models);
  return parsed.success ? parsed.data : null;
}

/** Stores the operator's per-step choice (validated); an unknown step or id is refused. */
export async function saveShapeStepModels(
  scope: string,
  models: StepModelsSelection
): Promise<StepModelsSelection> {
  const parsed = StepModelsSelectionSchema.parse(models);
  if (!isNeonConfigured()) {
    inMemoryStepModels.set(scope, parsed);
    return parsed;
  }
  const sql = neon(env.DATABASE_URL!);
  await ensureNeonTables(sql);
  const now = new Date().toISOString();
  await sql`
    INSERT INTO shape_step_models (scope, models, created_at, updated_at)
    VALUES (${scope}, ${JSON.stringify(parsed)}, ${now}, ${now})
    ON CONFLICT (scope) DO UPDATE SET models = EXCLUDED.models, updated_at = EXCLUDED.updated_at;
  `;
  return parsed;
}

export async function getScenarioDraft(id: string): Promise<ScenarioDraft | null> {
  if (!isNeonConfigured()) {
    return inMemoryScenarioDrafts.get(id)?.draft ?? null;
  }

  const sql = neon(env.DATABASE_URL!);
  await ensureNeonTables(sql);

  const rows = await sql`
    SELECT draft FROM scenario_drafts WHERE id = ${id} LIMIT 1;
  `;

  if (!rows || rows.length === 0) return null;
  return (rows[0] as { draft: ScenarioDraft }).draft;
}
