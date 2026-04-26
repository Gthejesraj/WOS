import type { Tool, ToolContext, ToolResult } from './index'

/**
 * EnterPlanMode — agent-initiated plan mode switch.
 * The query loop listens for this tool-call, treats it as a mode transition,
 * and does NOT forward it to tool execution.
 */
export const enterPlanModeTool: Tool = {
  name: 'EnterPlanMode',
  description:
    'Switch the conversation into planning mode. Use when the task is complex ' +
    'and you want to present a structured plan for user approval BEFORE executing ' +
    'any write/edit/bash tools. In plan mode only read-only tools are permitted.',
  inputSchema: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: 'Why plan mode is appropriate here.' },
    },
  },
  async execute(_input: unknown, _ctx: ToolContext): Promise<ToolResult> {
    // Actually handled by the query loop; this is only reached on unexpected dispatch.
    return { output: 'entered_plan_mode' }
  },
}

/**
 * ExitPlanMode — agent signals its plan is complete and requests approval.
 * The loop intercepts this tool-call, pauses for user approval, then either
 * transitions to default mode or asks the agent to revise.
 */
export const exitPlanModeTool: Tool = {
  name: 'ExitPlanMode',
  description:
    'Call this ONLY in plan mode, when your plan is complete and ready for the ' +
    'user to approve. Pass the full numbered plan as the `plan` argument. The system ' +
    'will pause and request user approval. Do not call any other tools in plan mode.',
  inputSchema: {
    type: 'object',
    properties: {
      plan: { type: 'string', description: 'The full numbered plan to present for approval.' },
    },
    required: ['plan'],
  },
  async execute(_input: unknown, _ctx: ToolContext): Promise<ToolResult> {
    return { output: 'exited_plan_mode' }
  },
}
