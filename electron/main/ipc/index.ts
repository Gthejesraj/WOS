import { BrowserWindow } from 'electron'
import { registerAgentHandlers } from './agent'
import { registerWorkspaceHandlers } from './workspace'
import { registerSettingsHandlers } from './settings'
import { registerDbHandlers } from './db'
import { registerAppsHandlers } from './apps'
import { registerMcpHandlers } from './mcp'
import { registerSkillsHandlers } from './skills'
import { registerRulesHandlers } from './rules'
import { registerMeetingsHandlers, setMainWindowForMeetings } from './meetings'
import { registerDictationHandlers } from './dictation'

let registered = false

export function registerIpcHandlers(win: BrowserWindow) {
  if (registered) return
  registered = true
  registerAgentHandlers(win)
  registerWorkspaceHandlers()
  registerSettingsHandlers()
  registerDbHandlers()
  registerAppsHandlers()
  registerMcpHandlers()
  registerSkillsHandlers()
  registerRulesHandlers()
  setMainWindowForMeetings(win)
  registerMeetingsHandlers()
  registerDictationHandlers()
}
