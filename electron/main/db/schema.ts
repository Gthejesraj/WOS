import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  path: text('path').notNull().unique(),
  name: text('name').notNull(),
  addedAt: integer('added_at', { mode: 'timestamp' }).notNull(),
  lastAccessedAt: integer('last_accessed_at', { mode: 'timestamp' }),
})

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  title: text('title').notNull().default('New Conversation'),
  workspaceId: text('workspace_id'),
  model: text('model').notNull().default('gpt-4o'),
  mode: text('mode').notNull().default('default'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  tokenCount: integer('token_count').notNull().default(0),
  contextLimit: integer('context_limit').notNull().default(200000),
  isCompacted: integer('is_compacted', { mode: 'boolean' }).notNull().default(false),
})

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull(),
  role: text('role').notNull(),
  blocks: text('blocks', { mode: 'json' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  tokenCount: integer('token_count').default(0),
  // Branching: messages edited from the same point share a branchGroupId.
  // branchIndex 0 = original, 1 = first edit, 2 = second edit, etc.
  branchGroupId: text('branch_group_id'),
  branchIndex: integer('branch_index').default(0),
})

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const apiKeys = sqliteTable('api_keys', {
  provider: text('provider').primaryKey(),
  encryptedKey: text('encrypted_key').notNull(),
  iv: text('iv').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const permissionGrants = sqliteTable('permission_grants', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull(),
  toolName: text('tool_name').notNull(),
  scope: text('scope').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

// Built-in Apps (Slack, GitHub, etc.) — one row per connected app.
// `credsJson` is encrypted JSON blob of whatever auth material the app needs
// (token, signing secret, refresh token, …). `iv` + `encryptedKey` pattern
// mirrors `api_keys` and uses the same AES-256 machine-derived key.
export const appConnections = sqliteTable('app_connections', {
  appId: text('app_id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  encryptedCreds: text('encrypted_creds').notNull(),
  iv: text('iv').notNull(),
  metadataJson: text('metadata_json', { mode: 'json' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

// User-configured MCP servers. `envEncrypted`/`envIv` store a JSON object
// with encrypted env values (for secrets like API tokens).
export const mcpServers = sqliteTable('mcp_servers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  transport: text('transport').notNull(), // 'stdio' | 'http' | 'sse'
  command: text('command'),
  argsJson: text('args_json', { mode: 'json' }),
  url: text('url'),
  envEncrypted: text('env_encrypted'),
  envIv: text('env_iv'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  toolPrefix: text('tool_prefix'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

// Skills discovered from `~/.wos/skills/**` and `<workspace>/.wos/skills/**`.
export const skills = sqliteTable('skills', {
  id: text('id').primaryKey(),
  source: text('source').notNull(), // 'user' | 'workspace'
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  path: text('path').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  triggersJson: text('triggers_json', { mode: 'json' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

// Rules — both user-level (~/.wos/rules/*.md) and per-workspace
// (<workspace>/.cursor/rules/*.mdc). Frontmatter fields are flattened into
// columns so we can filter cheaply without parsing every time.
export const rules = sqliteTable('rules', {
  id: text('id').primaryKey(),
  scope: text('scope').notNull(), // 'user' | 'workspace'
  workspaceId: text('workspace_id'),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  path: text('path').notNull(),
  alwaysApply: integer('always_apply', { mode: 'boolean' }).notNull().default(false),
  globs: text('globs', { mode: 'json' }),
  body: text('body').notNull().default(''),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

// Agent settings — per-agent model/mode/system-prompt overrides + per-agent API keys
export const agentSettings = sqliteTable('agent_settings', {
  agentKey: text('agent_key').primaryKey(), // 'wos' | 'meeting' | etc
  inheritFrom: text('inherit_from'), // fallback agent if not configured
  model: text('model'), // override model; null = inherit from global
  mode: text('mode'), // override mode; null = inherit from global
  systemPrompt: text('system_prompt'), // override system prompt; null = inherit
  configJson: text('config_json', { mode: 'json' }), // {openaiApiKey?, anthropicApiKey?, ...}
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

// Meeting records — from live sessions or uploads
export const meetings = sqliteTable('meetings', {
  id: text('id').primaryKey(),
  title: text('title').notNull().default('Untitled Meeting'),
  source: text('source').notNull(), // 'live' | 'upload' | 'calendar'
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  endedAt: integer('ended_at', { mode: 'timestamp' }),
  duration: integer('duration'), // seconds; computed after end
  transcript: text('transcript'), // full transcript text
  summary: text('summary'), // LLM-generated summary
  actionItemsJson: text('action_items_json', { mode: 'json' }), // [{owner, text, due}]
  decisionsJson: text('decisions_json', { mode: 'json' }), // [{decision, context}]
  speakerMapJson: text('speaker_map_json', { mode: 'json' }), // {name: [segments]} for live
  sourceUri: text('source_uri'), // Meet URL or file path
  agentKey: text('agent_key').default('meeting'), // which agent processed this
  processingStatus: text('processing_status').default('done'), // queued | reading | transcribing | analyzing | done | error | interrupted
  processingMessage: text('processing_message'),
  processingProgress: integer('processing_progress').default(100),
  lastError: text('last_error'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const meetingActivity = sqliteTable('meeting_activity', {
  id: text('id').primaryKey(),
  meetingId: text('meeting_id'),
  type: text('type').notNull(),
  status: text('status').notNull(),
  label: text('label').notNull(),
  detailJson: text('detail_json', { mode: 'json' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

// FTS5 full-text search over meetings
export const meetingsFts = sqliteTable('meetings_fts', {
  rowid: integer('rowid').primaryKey(),
  title: text('title'),
  transcript: text('transcript'),
  summary: text('summary'),
})

// ─── Automations (OpenClaw-inspired, scoped to user-installed apps) ──────────

// Scheduled jobs — cron expressions or one-shot runAt; agent runs happen in main process.
export const scheduledJobs = sqliteTable('scheduled_jobs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  cronExpr: text('cron_expr'),
  runAt: integer('run_at', { mode: 'timestamp' }),
  tz: text('tz').notNull().default('local'),
  target: text('target').notNull(), // 'new' | conversationId
  prompt: text('prompt').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  deleteAfterRun: integer('delete_after_run', { mode: 'boolean' }).notNull().default(false),
  lastRunAt: integer('last_run_at', { mode: 'timestamp' }),
  nextRunAt: integer('next_run_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const scheduledRuns = sqliteTable('scheduled_runs', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull(),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  endedAt: integer('ended_at', { mode: 'timestamp' }),
  status: text('status').notNull(), // 'running' | 'success' | 'error' | 'cancelled'
  error: text('error'),
  conversationId: text('conversation_id'),
})

// Hooks — react to in-process events ('message:received', 'app:connected', ...).
export const hooks = sqliteTable('hooks', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  event: text('event').notNull(),
  type: text('type').notNull(), // 'skill' | 'prompt' | 'tool'
  config: text('config', { mode: 'json' }).notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastFiredAt: integer('last_fired_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const hookRuns = sqliteTable('hook_runs', {
  id: text('id').primaryKey(),
  hookId: text('hook_id').notNull(),
  firedAt: integer('fired_at', { mode: 'timestamp' }).notNull(),
  status: text('status').notNull(), // 'success' | 'error' | 'timeout'
  error: text('error'),
  contextJson: text('context_json', { mode: 'json' }),
})

// Standing orders — long-lived rules injected into every system prompt.
// Stored separately from `rules` so we can attach scheduling/escalation metadata.
export const standingOrders = sqliteTable('standing_orders', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  body: text('body').notNull(),
  scope: text('scope').notNull().default('global'), // 'global' | conversation/workspace id
  triggersJson: text('triggers_json', { mode: 'json' }),
  approvalsJson: text('approvals_json', { mode: 'json' }),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

// Tasks — durable ledger for any detached run (scheduled, sub-agent, multi-step flow).
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  parentId: text('parent_id'),
  type: text('type').notNull(), // 'scheduled' | 'subagent' | 'flow' | 'hook'
  status: text('status').notNull().default('queued'), // 'queued' | 'running' | 'success' | 'error' | 'cancelled' | 'paused'
  title: text('title').notNull(),
  payload: text('payload', { mode: 'json' }),
  conversationId: text('conversation_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const taskSteps = sqliteTable('task_steps', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  idx: integer('idx').notNull(),
  status: text('status').notNull(),
  label: text('label').notNull(),
  output: text('output'),
  error: text('error'),
  ts: integer('ts', { mode: 'timestamp' }).notNull(),
})

// Sub-agent runs — invoked via wos.spawn_subagent tool, rendered inline in chat.
export const subagentRuns = sqliteTable('subagent_runs', {
  id: text('id').primaryKey(),
  parentMessageId: text('parent_message_id'),
  conversationId: text('conversation_id').notNull(),
  status: text('status').notNull().default('running'),
  goal: text('goal').notNull(),
  summary: text('summary'),
  tokensIn: integer('tokens_in').notNull().default(0),
  tokensOut: integer('tokens_out').notNull().default(0),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  endedAt: integer('ended_at', { mode: 'timestamp' }),
})
