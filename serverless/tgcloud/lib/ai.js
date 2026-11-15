import { db, fetch } from 'sdk';
import { eq, desc } from 'sdk/db';
import { messages } from '../schema.js';
import { getChat, touchChat, latestMessage, addMessage, findByTg } from './store.js';
import { sendText } from './tg.js';
import { alertAdmins } from './notify.js';
import { now, clip, faError } from './util.js';

export function aiEnabled(chat, st) {
  if (chat.aiMode === 'on') return true;
  if (chat.aiMode === 'off') return false;
  if (chat.isGroup) return false;     // گروه‌ها پیش‌فرض خاموش؛ از تنظیمات چت روشن می‌شن
  return !!st.ai_mode;
}

async function history(chatId, limit) {
  const rows = await db.select().from(messages).where(eq(messages.chatId, chatId))
    .orderBy(desc(messages.id)).limit(Math.max(5, Number(limit) || 60)).all();
  rows.reverse();
  const out = [];
  for (const r of rows) {
    const t = String(r.text || '').trim();
    if (!t) continue;
    const isUser = r.role === 'user';
    const text = isUser ? `${r.sender || 'مخاطب'}: ${t}` : t;
    const role = isUser ? 'user' : 'model';
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].parts[0].text += '\n' + text;
    else out.push({ role, parts: [{ text }] });
  }
  while (out.length && out[0].role === 'model') out.shift();
  return out;
}

async function callGemini(st, prompt, contents) {
  const key = String(st.gemini_api_key || '').trim();
  if (!key) throw new Error('کلید Gemini در تنظیمات پنل وارد نشده است.');
  const model = String(st.gemini_model || 'gemini-2.5-flash').trim();
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: prompt }] }, contents }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Gemini: ' + clip((data && data.error && data.error.message) || res.status, 300));
  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim();
  if (!text) throw new Error('Gemini پاسخ خالی برگرداند.');
  return text;
}

// بعد از اتمام سکوت صدا زده می‌شه. فقط اگر پیامِ من هنوز «آخرین پیام چت» باشه پاسخ می‌ده:
// پیام جدیدتر مخاطب → همان فراخوانی جواب می‌ده؛ پیام جدیدتر خودت/پنل → AI ساکت می‌مونه.
export async function runAi({ chatId, rowId, bizId, st }) {
  const latest = await latestMessage(chatId);
  if (!latest || latest.id !== rowId) {
    if (latest && latest.role !== 'user') await touchChat(chatId, { aiPendingUntil: 0 });
    return;
  }
  const chat = await getChat(chatId);
  if (!chat || !aiEnabled(chat, st)) { await touchChat(chatId, { aiPendingUntil: 0 }); return; }

  try {
    const contents = await history(chatId, st.ai_history_limit);
    if (!contents.length) { await touchChat(chatId, { aiPendingUntil: 0 }); return; }
    const reply = await callGemini(st, chat.prompt || st.system_prompt, contents);
    const label = String(st.assistant_label || '').trim();
    const text = label ? `${label}\n${reply}` : reply;
    const sent = await sendText({ chatId, text, bizId, markdown: false });
    await addMessage({ chatId, msgId: sent.message_id, role: 'model', sender: 'دستیار (AI)', text,
      ts: now(), senderMode: bizId ? 'me' : 'bot' });
    await touchChat(chatId, { lastText: clip(text, 200), lastSender: 'دستیار', lastTs: now(), aiPendingUntil: 0 });
  } catch (e) {
    await touchChat(chatId, { aiPendingUntil: 0 });
    const msg = faError(e);
    await alertAdmins(`خطای هوش مصنوعی در چت «${chat.title}»:\n${msg}`);
    try { await sendText({ chatId, text: 'ببخشید، الان نتونستم جواب بدم. کمی بعد دوباره پیام بده 🙏', bizId, markdown: false }); } catch (e2) { /* ignore */ }
  }
}
