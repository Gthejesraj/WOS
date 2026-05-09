import { BrowserWindow } from 'electron'
import { registerAgentHandlers } from './agent'
import { registerWorkspaceHandlers } from './workspace'
import { registerSettingsHandlers } from './settings'
import { registerRunPodHandlers } from './runpod'
import { registerDbHandlers } from './db'
import { registerAppsHandlers } from './apps'
import { registerMcpHandlers } from './mcp'
import { registerSkillsHandlers } from './skills'
import { registerRulesHandlers } from './rules'
import { registerMeetingsHandlers } from './meetings'
import { registerDictationHandlers } from './dictation'
import { registerAutomationsHandlers } from './automations'
import { registerPluginsHandlers } from './plugins'
import { registerProjectsHandlers } from './projects'

let registered = false

export function registerIpcHandlers(win: BrowserWindow) {
  if (registered) return
  registered = true
  registerAgentHandlers(win)
  registerWorkspaceHandlers()
  registerSettingsHandlers()
  registerRunPodHandlers()
  registerDbHandlers()
  registerAppsHandlers()
  registerMcpHandlers()
  registerSkillsHandlers()
  registerRulesHandlers()
  registerMeetingsHandlers()
  registerDictationHandlers()
  registerAutomationsHandlers()
  registerPluginsHandlers()
  registerProjectsHandlers()
}
