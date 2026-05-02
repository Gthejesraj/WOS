import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { initDatabase, runRaw } from '../../db'
import { createProject, deleteProject } from '../manager'
import { addPerson, listPeople, removePerson, updatePerson } from '../people'

const userData = (app as unknown as { getPath: (name: string) => string }).getPath('userData')

beforeAll(async () => {
  fs.mkdirSync(userData, { recursive: true })
  const dbPath = path.join(userData, 'wos.db')
  if (fs.existsSync(dbPath)) fs.rmSync(dbPath)
  await initDatabase()
})

afterAll(() => {
  const dbPath = path.join(userData, 'wos.db')
  if (fs.existsSync(dbPath)) fs.rmSync(dbPath)
})

beforeEach(() => {
  runRaw('DELETE FROM project_people')
  runRaw('DELETE FROM projects')
})

describe('project people CRUD', () => {
  it('adds, lists, updates and removes people', () => {
    const proj = createProject({ name: 'Atlas' })
    expect(listPeople(proj.id)).toEqual([])

    const p1 = addPerson(proj.id, { name: 'Alice', email: 'a@x.io', role: 'PM' })
    const p2 = addPerson(proj.id, { name: 'Bob', email: 'b@x.io', role: 'Eng' })
    const list = listPeople(proj.id)
    expect(list).toHaveLength(2)
    expect(list[0].name).toBe('Alice')
    expect(list[0].sourceApp).toBe('manual')

    const updated = updatePerson(p1.id, { role: 'Director', notes: 'sponsor' })
    expect(updated?.role).toBe('Director')
    expect(updated?.notes).toBe('sponsor')
    expect(updated?.email).toBe('a@x.io')

    removePerson(p2.id)
    expect(listPeople(proj.id).map(p => p.id)).toEqual([p1.id])
  })

  it('cascades delete when project is removed', () => {
    const proj = createProject({ name: 'Beacon' })
    addPerson(proj.id, { name: 'Carol', email: 'c@x.io' })
    expect(listPeople(proj.id)).toHaveLength(1)
    deleteProject(proj.id)
    expect(listPeople(proj.id)).toEqual([])
  })

  it('returns null when updating a missing person', () => {
    expect(updatePerson('does-not-exist', { name: 'Z' })).toBeNull()
  })

  it('trims whitespace and normalises empty optional fields', () => {
    const proj = createProject({ name: 'Comet' })
    const person = addPerson(proj.id, { name: '  Dan  ', email: '  ', role: '' })
    expect(person.name).toBe('Dan')
    expect(person.email).toBeNull()
    expect(person.role).toBeNull()
  })
})
