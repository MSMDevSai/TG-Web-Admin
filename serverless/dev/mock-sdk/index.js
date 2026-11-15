import { dbImpl } from './db.js';
export const db = dbImpl;
export class BotApiError extends Error { constructor(description, code = 400) { super(description); this.description = description; this.code = code; } }
export class EndpointError extends Error { constructor(message, parameters) { super(message); this.parameters = parameters; } }
export class InputFile { constructor(bytes, name, o) { this.bytes = bytes; this.name = name; this.type = o && o.type; } }
let mid = 1000;
globalThis.__calls = []; globalThis.__apiFail = {}; globalThis.__gemini = { text: 'سلام! من AI هستم' }; globalThis.__fetches = [];
export const api = new Proxy({}, { get: (_, method) => async (p = {}) => {
  globalThis.__calls.push({ method, p });
  if (globalThis.__apiFail[method]) throw new BotApiError(globalThis.__apiFail[method]);
  if (method === 'getBusinessConnection') return { user: { id: 777 }, is_enabled: true };
  if (method === 'getFileContent') return new Uint8Array(Array.from({ length: 1000 }, (_, i) => i & 255));
  if (/^send/.test(method)) {
    const m = { message_id: ++mid, chat: { id: p.chat_id }, date: Math.floor(Date.now() / 1000) };
    if (method === 'sendPhoto') m.photo = [{ file_id: 'ph1', file_unique_id: 'uph1', file_size: 100 }];
    if (method === 'sendVoice') m.voice = { file_id: 'vo1', file_unique_id: 'uvo1', mime_type: 'audio/ogg', file_size: 100 };
    if (method === 'sendDocument') m.document = { file_id: 'do1', file_unique_id: 'udo1', file_name: 'a.bin', file_size: 100 };
    return m;
  }
  return {};
} });
export const fetch = async (url, o) => { globalThis.__fetches.push({ url, o }); return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: globalThis.__gemini.text }] } }] }) }; };
