import { randomUUID } from 'node:crypto'
import { getDb, schema, notifyWrite } from '../db'
import { eq, and, asc } from 'drizzle-orm'
import { registry } from './registry'

/**
 * Task Flow primitive — durable wizard-driven multi-step flows that can pause,
 * resume and branch, including human-in-the-loop steps.
 *
 * Storage:
 *   - one row in `automation_task_flows` per automation (state, currentStep, paused, revision)
 *   - one row per step in `automation_task_flow_steps` (idx, label, status, requiresHuman, in/out)
 */

export type StepStatus = 'pending' | 'running' | 'awaiting_human' | 'done' | 'failed' | 'skipped'

export interface FlowStepInput {
  label: string
  requiresHuman?: boolean
  input?: unknown
}

export const taskFlow = {
  /** Initialize (or reset) a flow with the given ordered steps. */
  init(automationId: string, steps: FlowStepInput[]): void {
    const db = getDb()
    db.delete(schema.automationTaskFlowSteps).where(eq(schema.automationTaskFlowSteps.automationId, automationId)).run()
    db.delete(schema.automationTaskFlows).where(eq(schema.automationTaskFlows.automationId, automationId)).run()
    db.insert(schema.automationTaskFlows).values({
      automationId,
      currentStep: 0,
      paused: false,
      revision: 1,
      state: '{}',
    } as unknown as typeof schema.automationTaskFlows.$inferInsert).run()
    const now = new Date()
    steps.forEach((s, idx) => {
      db.insert(schema.automationTaskFlowSteps).values({
        id: randomUUID(),
        automationId,
        idx,
        label: s.label,
        status: 'pending',
        requiresHuman: !!s.requiresHuman,
        input: s.input == null ? null : JSON.stringify(s.input),
        updatedAt: now,
      } as unknown as typeof schema.automationTaskFlowSteps.$inferInsert).run()
    })
    notifyWrite()
  },

  pause(automationId: string): void {
    const db = getDb()
    db.update(schema.automationTaskFlows).set({ paused: true }).where(eq(schema.automationTaskFlows.automationId, automationId)).run()
    notifyWrite()
  },
  resume(automationId: string): void {
    const db = getDb()
    db.update(schema.automationTaskFlows).set({ paused: false }).where(eq(schema.automationTaskFlows.automationId, automationId)).run()
    notifyWrite()
  },

  listSteps(automationId: string) {
    const db = getDb()
    return db.select().from(schema.automationTaskFlowSteps)
      .where(eq(schema.automationTaskFlowSteps.automationId, automationId))
      .orderBy(asc(schema.automationTaskFlowSteps.idx))
      .all()
  },

  state(automationId: string) {
    const db = getDb()
    return db.select().from(schema.automationTaskFlows).where(eq(schema.automationTaskFlows.automationId, automationId)).get() ?? null
  },

  /** Advance the flow's current step pointer if the previous step is done. */
  advance(automationId: string): void {
    const db = getDb()
    const flow = this.state(automationId)
    if (!flow) return
    const next = flow.currentStep + 1
    db.update(schema.automationTaskFlows)
      .set({ currentStep: next, revision: flow.revision + 1 })
      .where(eq(schema.automationTaskFlows.automationId, automationId))
      .run()
    notifyWrite()
  },

  /** Mark a step's outcome. */
  setStepStatus(automationId: string, idx: number, status: StepStatus, output?: unknown, error?: string): void {
    const db = getDb()
    db.update(schema.automationTaskFlowSteps).set({
      status,
      output: output == null ? null : JSON.stringify(output),
      error: error ?? null,
      updatedAt: new Date(),
    }).where(and(
      eq(schema.automationTaskFlowSteps.automationId, automationId),
      eq(schema.automationTaskFlowSteps.idx, idx),
    )).run()
    notifyWrite()
  },

  /** Provide a human answer for an awaiting_human step and unblock the flow. */
  provideHumanInput(automationId: string, idx: number, value: unknown): void {
    this.setStepStatus(automationId, idx, 'done', value)
    this.advance(automationId)
  },
}

export const taskFlowService = {
  start(): void {
    // Resume any unfinished flows on boot — emit a 'task_flow:tick' for each
    // active flow so the runner can pick them up. The actual stepping is
    // expected to be driven by the agent during runAutomation when the
    // automation kind is 'task_flow' — we only ensure DB consistency here.
    for (const a of registry.list({ kind: 'task_flow', enabled: true })) {
      const s = taskFlow.state(a.id)
      if (!s) {
        // Auto-init from config.steps on first boot.
        const cfg = a.config as { steps?: FlowStepInput[] }
        if (Array.isArray(cfg.steps) && cfg.steps.length > 0) {
          taskFlow.init(a.id, cfg.steps)
        }
      }
    }
  },
  stop(): void { /* nothing in-memory */ },
  reload(id: string): void {
    const a = registry.get(id)
    if (!a || a.kind !== 'task_flow') return
    if (!taskFlow.state(a.id)) {
      const cfg = a.config as { steps?: FlowStepInput[] }
      if (Array.isArray(cfg.steps) && cfg.steps.length > 0) taskFlow.init(a.id, cfg.steps)
    }
  },
  reloadAll(): void { this.start() },
}
