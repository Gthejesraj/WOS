import type { ProjectActivityRow, ProjectPersonRow, ProjectResourceRow } from '../../../../store/projectsStore'

interface PersonInput {
  name: string
  email?: string
  sourceApp?: string
  externalId?: string
  avatarUrl?: string
}

function dedup(items: PersonInput[], existing: ProjectPersonRow[]): PersonInput[] {
  const seenIds = new Set(existing.map(p => p.externalId).filter(Boolean))
  const seenEmails = new Set(existing.map(p => p.email?.toLowerCase()).filter(Boolean))
  const result: PersonInput[] = []
  const localIds = new Set<string>()
  const localEmails = new Set<string>()

  for (const item of items) {
    const id = item.externalId
    const email = item.email?.toLowerCase()
    if (id && (seenIds.has(id) || localIds.has(id))) continue
    if (email && (seenEmails.has(email) || localEmails.has(email))) continue
    if (id) localIds.add(id)
    if (email) localEmails.add(email)
    result.push(item)
  }
  return result
}

export async function autoPopulatePeople(
  projectId: string,
  resources: ProjectResourceRow[],
): Promise<void> {
  const slackChannels = resources.filter(r => r.kind === 'slack:channel')
  if (slackChannels.length === 0) return

  try {
    const existing = (await window.wos.projects.listPeople(projectId)) as ProjectPersonRow[]
    const snapshotRaw = await window.wos.projects.appSnapshot('slack', 'users')
    const snapshot = (snapshotRaw as unknown) as Array<{
      id?: string; real_name?: string; name?: string; profile?: { email?: string; image_48?: string }
    }>
    if (!Array.isArray(snapshot)) return

    const candidates: PersonInput[] = snapshot
      .filter(u => u.id && u.id !== 'USLACKBOT')
      .map(u => ({
        name: u.real_name || u.name || u.id || 'Unknown',
        email: u.profile?.email,
        sourceApp: 'slack',
        externalId: `slack:${u.id}`,
        avatarUrl: u.profile?.image_48,
      }))

    const toAdd = dedup(candidates, existing)
    for (const person of toAdd) {
      await window.wos.projects.addPerson(projectId, person)
    }
  } catch {
    // Non-fatal; Slack may not be connected
  }
}

export async function populatePeopleFromActivity(
  projectId: string,
  activity: ProjectActivityRow[],
  existingPeople: ProjectPersonRow[],
): Promise<void> {
  const candidates: PersonInput[] = []

  for (const a of activity) {
    if (!a.actor) continue
    const app = a.sourceApp?.toLowerCase()

    if (app === 'github') {
      candidates.push({
        name: a.actor,
        sourceApp: 'github',
        externalId: `github:${a.actor}`,
      })
    } else if (app === 'google') {
      const email = a.actor.includes('@') ? a.actor : undefined
      candidates.push({
        name: a.actor,
        email,
        sourceApp: 'google',
        externalId: `google:${a.actor.toLowerCase()}`,
      })
    }
  }

  const toAdd = dedup(candidates, existingPeople)
  for (const person of toAdd) {
    try {
      await window.wos.projects.addPerson(projectId, person)
    } catch {
      // skip duplicates silently
    }
  }
}
