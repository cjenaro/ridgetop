import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

export const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

const wsKeyPattern = /^[A-Za-z0-9+/]{22}==$/
const utf8Fatal = new TextDecoder('utf-8', { fatal: true })

const HTTP_REASONS: Readonly<Record<number, string>> = Object.freeze({
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  413: 'Payload Too Large',
  426: 'Upgrade Required',
  500: 'Internal Server Error',
  503: 'Service Unavailable'
})

export function defaultHttpReason(status: number): string {
  return Object.hasOwn(HTTP_REASONS, status) ? HTTP_REASONS[status] : 'Error'
}

export function rejectUpgrade(
  socket: Duplex,
  status: number,
  reason = defaultHttpReason(status),
  extraHeaders = ''
): void {
  if (socket.listenerCount('error') === 0) {
    socket.on('error', () => { /* ignore pre-close socket error */ })
  }
  if (!socket.destroyed && socket.writable) {
    try {
      socket.write(`HTTP/1.1 ${status} ${reason}\r\nContent-Length: 0\r\nConnection: close\r\n${extraHeaders}\r\n`)
    } catch { /* ignore write errors on closing socket */ }
  }
  socket.destroy()
}

export function headerHasToken(value: string | string[] | undefined, token: string): boolean {
  const raw = Array.isArray(value) ? value.join(',') : (value ?? '')
  return raw.split(',').some(part => part.trim().toLowerCase() === token)
}

export function computeWsAccept(key: string): string {
  return createHash('sha1').update(key + WS_GUID).digest('base64')
}

export type WsHandshakeResult =
  | { readonly ok: true; readonly key: string; readonly accept: string }
  | { readonly ok: false; readonly status: number; readonly reason: string; readonly extraHeaders?: string }

export function validateWsUpgradeRequest(
  req: Pick<IncomingMessage, 'method' | 'headers'>
): WsHandshakeResult {
  if (req.method !== 'GET') {
    return { ok: false, status: 405, reason: 'Method Not Allowed' }
  }
  const wsVersion = String(req.headers['sec-websocket-version'] ?? '')
  if (wsVersion !== '13') {
    return { ok: false, status: 426, reason: 'Upgrade Required', extraHeaders: 'Sec-WebSocket-Version: 13\r\n' }
  }
  const wsKey = typeof req.headers['sec-websocket-key'] === 'string' ? req.headers['sec-websocket-key'].trim() : ''
  if (
    !headerHasToken(req.headers.upgrade, 'websocket') ||
    !headerHasToken(req.headers.connection, 'upgrade') ||
    !wsKeyPattern.test(wsKey) ||
    Buffer.from(wsKey, 'base64').byteLength !== 16
  ) {
    return { ok: false, status: 400, reason: 'Bad Request' }
  }
  return { ok: true, key: wsKey, accept: computeWsAccept(wsKey) }
}

export function encodeWsFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.byteLength
  let headerLen = 2
  if (len >= 65_536) headerLen = 10
  else if (len >= 126) headerLen = 4
  const frame = Buffer.allocUnsafe(headerLen + len)
  frame[0] = 0x80 | (opcode & 0x0f)
  if (len < 126) {
    frame[1] = len
  } else if (len < 65_536) {
    frame[1] = 126
    frame.writeUInt16BE(len, 2)
  } else {
    frame[1] = 127
    frame.writeBigUInt64BE(BigInt(len), 2)
  }
  payload.copy(frame, headerLen)
  return frame
}

export function truncateUtf8(text: string, maxBytes: number): Buffer {
  if (maxBytes <= 0) return Buffer.alloc(0)
  const buf = Buffer.from(text, 'utf8')
  if (buf.byteLength <= maxBytes) return buf
  let end = maxBytes
  // Step back over UTF-8 continuation bytes (10xxxxxx) to find the start of the split character.
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--
  // If the byte at `end` is a multi-byte lead byte whose full sequence exceeds maxBytes, exclude it.
  if (end > 0 && (buf[end] & 0x80) !== 0) {
    const lead = buf[end]
    const charLen = (lead & 0xe0) === 0xc0 ? 2 : (lead & 0xf0) === 0xe0 ? 3 : (lead & 0xf8) === 0xf0 ? 4 : 1
    if (end + charLen > maxBytes) return buf.subarray(0, end)
  }
  return buf.subarray(0, end)
}

export function encodeWsClose(code: number, reason = ''): Buffer {
  const reasonBuf = reason ? truncateUtf8(reason, 123) : Buffer.alloc(0)
  const payload = Buffer.allocUnsafe(2 + reasonBuf.byteLength)
  payload.writeUInt16BE(code, 0)
  reasonBuf.copy(payload, 2)
  return encodeWsFrame(0x8, payload)
}

export function isValidWireCloseCode(code: number): boolean {
  if (code >= 3000 && code <= 4999) return true
  return (code >= 1000 && code <= 1003) || (code >= 1007 && code <= 1011)
}

export type WsDecodedEvent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'ping'; readonly payload: Buffer }
  | { readonly type: 'pong'; readonly payload: Buffer }
  | { readonly type: 'close'; readonly code: number; readonly reason: string }
  | { readonly type: 'error'; readonly code: number; readonly reason: string }

export interface WsFrameDecoderOptions {
  readonly maxPayloadBytes?: number
  readonly maxPendingBytes?: number
  readonly requireMask?: boolean
}

export interface WsFrameDecoder {
  readonly closed: boolean
  feed(chunk: Buffer): WsDecodedEvent[]
}

export function createWsFrameDecoder(options: WsFrameDecoderOptions = {}): WsFrameDecoder {
  const maxPayloadBytes = options.maxPayloadBytes ?? 4096
  const maxPendingBytes = options.maxPendingBytes ?? Math.max(65_536, (maxPayloadBytes + 14) * 16)
  const requireMask = options.requireMask ?? true

  let closed = false
  let pending: Buffer = Buffer.alloc(0)
  let fragments: Buffer[] | null = null
  let fragmentBytes = 0

  function fail(events: WsDecodedEvent[], code: number, reason: string): WsDecodedEvent[] {
    closed = true
    pending = Buffer.alloc(0)
    fragments = null
    fragmentBytes = 0
    events.push({ type: 'error', code, reason })
    return events
  }

  return {
    get closed() {
      return closed
    },
    feed(chunk: Buffer): WsDecodedEvent[] {
      const events: WsDecodedEvent[] = []
      if (closed || !chunk.byteLength) return events
      if (pending.byteLength + chunk.byteLength > maxPendingBytes) {
        return fail(events, 1009, 'Payload too large')
      }
      pending = pending.byteLength ? Buffer.concat([pending, chunk]) : chunk

      while (!closed && pending.byteLength >= 2) {
        const b0 = pending[0]
        const b1 = pending[1]
        const fin = (b0 & 0x80) !== 0
        const rsv = b0 & 0x70
        const opcode = b0 & 0x0f
        const masked = (b1 & 0x80) !== 0
        let length = b1 & 0x7f
        let offset = 2

        if (rsv !== 0) return fail(events, 1002, 'Reserved bits set')
        if (requireMask && !masked) return fail(events, 1002, 'Client frames must be masked')

        const isControl = (opcode & 0x08) !== 0
        if (isControl) {
          if (!fin) return fail(events, 1002, 'Control frames must not be fragmented')
          if (length > 125) return fail(events, 1002, 'Control frame too large')
        }

        if (length === 126) {
          if (pending.byteLength < 4) return events
          length = pending.readUInt16BE(2)
          offset = 4
        } else if (length === 127) {
          if (pending.byteLength < 10) return events
          const hi = pending.readUInt32BE(2)
          if (hi >= 0x8000_0000) return fail(events, 1002, 'Invalid 64-bit payload length')
          if (hi > 0x001f_ffff) return fail(events, 1009, 'Payload too large')
          length = Number(pending.readBigUInt64BE(2))
          offset = 10
        }

        if (length > maxPayloadBytes) return fail(events, 1009, 'Payload too large')

        if (!isControl) {
          if (opcode === 0x0) {
            if (!fragments) return fail(events, 1002, 'Unexpected continuation frame')
            if (fragmentBytes + length > maxPayloadBytes) return fail(events, 1009, 'Message too large')
          } else if (opcode === 0x1) {
            if (fragments) return fail(events, 1002, 'Expected continuation frame')
          } else if (opcode === 0x2) {
            return fail(events, 1003, 'Binary frames not supported')
          } else {
            return fail(events, 1002, 'Unsupported opcode')
          }
        } else if (opcode !== 0x8 && opcode !== 0x9 && opcode !== 0xa) {
          return fail(events, 1002, 'Unsupported control opcode')
        }

        const maskLen = masked ? 4 : 0
        const frameTotal = offset + maskLen + length
        if (pending.byteLength < frameTotal) return events

        const payloadStart = offset + maskLen
        const payload = Buffer.allocUnsafe(length)
        if (masked) {
          const mask0 = pending[offset]
          const mask1 = pending[offset + 1]
          const mask2 = pending[offset + 2]
          const mask3 = pending[offset + 3]
          for (let i = 0; i < length; i++) {
            const m = (i & 3) === 0 ? mask0 : (i & 3) === 1 ? mask1 : (i & 3) === 2 ? mask2 : mask3
            payload[i] = pending[payloadStart + i] ^ m
          }
        } else {
          pending.copy(payload, 0, payloadStart, frameTotal)
        }
        pending = frameTotal === pending.byteLength ? Buffer.alloc(0) : pending.subarray(frameTotal)

        if (opcode === 0x8) {
          if (length === 1) return fail(events, 1002, 'Invalid close payload')
          if (length >= 2) {
            const closeCode = payload.readUInt16BE(0)
            if (!isValidWireCloseCode(closeCode)) return fail(events, 1002, 'Invalid close code')
            let closeReason = ''
            if (length > 2) {
              try {
                closeReason = utf8Fatal.decode(payload.subarray(2))
              } catch {
                return fail(events, 1007, 'Invalid UTF-8 in close reason')
              }
            }
            closed = true
            events.push({ type: 'close', code: closeCode, reason: closeReason })
            return events
          }
          closed = true
          events.push({ type: 'close', code: 1000, reason: '' })
          return events
        }

        if (opcode === 0x9) {
          events.push({ type: 'ping', payload })
          continue
        }
        if (opcode === 0xa) {
          events.push({ type: 'pong', payload })
          continue
        }

        let complete: Buffer
        if (opcode === 0x1 && fin) {
          complete = payload
        } else {
          if (opcode === 0x1) {
            fragments = [payload]
            fragmentBytes = length
          } else {
            if (!fragments) return fail(events, 1002, 'Unexpected continuation frame')
            fragments.push(payload)
            fragmentBytes += length
          }
          if (!fin) continue
          complete = Buffer.concat(fragments, fragmentBytes)
          fragments = null
          fragmentBytes = 0
        }

        let text: string
        try {
          text = utf8Fatal.decode(complete)
        } catch {
          return fail(events, 1007, 'Invalid UTF-8')
        }
        events.push({ type: 'text', text })
      }
      return events
    }
  }
}

function disableNagle(socket: Duplex): void {
  if ('setNoDelay' in socket && typeof socket.setNoDelay === 'function') {
    socket.setNoDelay(true)
  }
}

export interface WsConnection {
  readonly socket: Duplex
  readonly closed: boolean
  sendFrame(frame: Buffer): boolean
  sendText(text: string): boolean
  close(code?: number, reason?: string): void
}

export interface AcceptWsOptions {
  readonly accept: string
  readonly head?: Buffer
  readonly initialFrame?: Buffer
  readonly maxPayloadBytes?: number
  readonly frameBudget?: number
  onOpen?(connection: WsConnection): void
  onText(text: string): void
  onClose(): void
}

export function acceptWsConnection(socket: Duplex, options: AcceptWsOptions): WsConnection | null {
  const frameBudget = options.frameBudget ?? 16_384
  const decoder = createWsFrameDecoder({ maxPayloadBytes: options.maxPayloadBytes })

  let closed = false
  let notifiedClose = false
  let closeTimer: ReturnType<typeof setTimeout> | undefined

  function clearCloseTimer() {
    if (closeTimer !== undefined) {
      clearTimeout(closeTimer)
      closeTimer = undefined
    }
  }

  function notifyClose() {
    if (notifiedClose) return
    notifiedClose = true
    options.onClose()
  }

  function closeSocket(code = 1000, reason = '') {
    if (closed) return
    closed = true
    if (!socket.destroyed && socket.writable) {
      try {
        socket.write(encodeWsClose(code, reason))
        socket.end()
        closeTimer = setTimeout(() => {
          closeTimer = undefined
          if (!socket.destroyed) socket.destroy()
        }, 1500)
        closeTimer.unref?.()
      } catch {
        socket.destroy()
      }
    } else if (!socket.destroyed) {
      socket.destroy()
    }
  }

  function sendFrame(frame: Buffer): boolean {
    if (closed || socket.destroyed || !socket.writable || socket.writableLength >= frameBudget) return false
    socket.write(frame)
    return true
  }

  function sendText(text: string): boolean {
    return sendFrame(encodeWsFrame(0x1, Buffer.from(text, 'utf8')))
  }

  const connection: WsConnection = {
    socket,
    get closed() {
      return closed
    },
    sendFrame,
    sendText,
    close: closeSocket
  }

  const onDisconnect = () => {
    closed = true
    clearCloseTimer()
    notifyClose()
  }
  socket.on('close', onDisconnect)
  socket.on('error', onDisconnect)

  disableNagle(socket)
  try {
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${options.accept}\r\n` +
      '\r\n'
    )
    if (options.initialFrame) socket.write(options.initialFrame)
  } catch {
    closed = true
    clearCloseTimer()
    socket.destroy()
    return null
  }

  options.onOpen?.(connection)

  function onData(chunk: Buffer) {
    if (closed || !chunk.byteLength) return
    const events = decoder.feed(chunk)
    for (let i = 0; i < events.length; i++) {
      if (closed) return
      const event = events[i]
      if (event.type === 'text') {
        options.onText(event.text)
      } else if (event.type === 'ping') {
        sendFrame(encodeWsFrame(0xa, event.payload))
      } else if (event.type === 'close') {
        closeSocket(event.code)
        notifyClose()
        return
      } else if (event.type === 'error') {
        closeSocket(event.code, event.reason)
        notifyClose()
        return
      }
    }
  }

  socket.on('data', onData)
  if (options.head && options.head.byteLength > 0) onData(options.head)
  if (socket.destroyed) onDisconnect()
  return connection
}
