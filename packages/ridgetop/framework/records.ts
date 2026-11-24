import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Records } from './server-types.ts'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import process from 'node:process'

export function createRecords<T>(file?: string, saved: Iterable<readonly [string, T]> = []): Records<T> {
  const records = new Map(saved)
  let pending = Promise.resolve()
  let dirty = false
  return {
    get(id) { return id === undefined ? undefined : records.get(id) },
    set(id, record) {
      records.set(id, record)
      dirty = true
    },
    save() {
      if (!file || !dirty) return pending
      dirty = false
      pending = pending.catch(() => {}).then(async () => {
        const value = JSON.stringify([...records])
        const temp = `${file}.${process.pid}.${randomUUID()}.tmp`
        try {
          await mkdir(dirname(file), { recursive: true, mode: 0o700 })
          await writeFile(temp, value, { mode: 0o600 })
          await rename(temp, file)
        } catch (error) {
          await unlink(temp).catch(() => {})
          dirty = true
          throw error
        }
      })
      return pending
    }
  }
}

export async function openRecords<T>(file: string): Promise<Records<T>> {
  let saved
  try {
    saved = JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') throw error
  }
  return createRecords<T>(file, saved)
}

export function createIdentity() { return randomUUID() }

export function createCookieSession({ name, path, maxAge }: { name: string; path: string; maxAge: number }) {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new TypeError('Invalid session cookie name')
  const pattern = new RegExp('(?:^|;\\s*)' + name + '=([a-f0-9-]{36})(?:;|$)')
  return {
    read(req: IncomingMessage) { return pattern.exec(req.headers.cookie ?? '')?.[1] },
    write(req: IncomingMessage, res: ServerResponse, id: string) {
      res.setHeader('Set-Cookie', name + '=' + id + '; Path=' + path +
        '; HttpOnly; SameSite=Strict; Max-Age=' + maxAge + ('encrypted' in req.socket && req.socket.encrypted ? '; Secure' : ''))
    }
  }
}
