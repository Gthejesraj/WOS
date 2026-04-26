import { ipcMain } from 'electron'
import {
  listSkills,
  scanSkills,
  setSkillEnabled,
  readSkillBody,
  createSkill,
  deleteSkill,
} from '../skills/manager'

export function registerSkillsHandlers() {
  ipcMain.handle('skills:list', () => listSkills())

  ipcMain.handle('skills:reload', () => {
    const list = scanSkills()
    return { success: true, count: list.length }
  })

  ipcMain.handle('skills:set-enabled', async (_e, { id, enabled }: { id: string; enabled: boolean }) => {
    setSkillEnabled(id, enabled)
    return { success: true }
  })

  ipcMain.handle('skills:read', async (_e, id: string) => {
    const r = readSkillBody(id)
    if (!r) return { success: false, error: 'Skill not found' }
    return { success: true, body: r.body, meta: r.meta }
  })

  ipcMain.handle('skills:create', async (_e, input: { name: string; description?: string; body: string; triggers?: string[] }) => {
    try {
      const { id } = createSkill(input)
      return { success: true, id }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('skills:delete', async (_e, id: string) => {
    deleteSkill(id)
    return { success: true }
  })
}
