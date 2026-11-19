import type { Server } from 'node:http'

export interface GameHost {
  server: Server
  close(): Promise<void>
}

export interface Records<T> {
  get(id: string | undefined): T | undefined
  set(id: string, record: T): void
  save(): Promise<void>
}
