import { db, api } from 'sdk';
import { eq } from 'sdk/db';
import { connections } from '../schema.js';
import { getSettings, getChat, touchChat, addMessage, findByTg, saveConnection } from './store.js';
import { describeMedia, archiveMedia } from './media.js';
import { sendText } from './tg.js';
import { notifyMembers, alertAdmins } from './notify.js';
import { aiEnabled, runAi } from './ai.js';
import { now, sleep, clip, fullName } from './util.js';

// صاحب اکانت بیزینس (برای تشخیص پیام‌های خودت از مخاطب)
export async function ownerOf(bizId) {
  const r = await db.select().from(connections).where(eq(connections.id, bizId)).get();
  if (r && r.userId) return r.userId;
  try {
    const c = await api.getBusinessConnection({ business_connection_id: bizId });
    if (c && c.user) { await saveConnection(bizId, c.user.id, c.is_enabled !== false); return c.user.id; }
  } catch (e) { /* ignore */ }
  return null;
}

function replyInfo(msg) {
  const r = msg.reply_to_message;
  if (!r) return {};
  const rp = (r.text || r.caption || (describeMedia(r) || {}).ph || '').trim();
  return { replyToMsgId: r.message_id, replyPreview: clip(rp, 140) };
}

function forwardedFrom(msg) {
  const o = msg.forward_origin;
  if (!o) return null;
  if (o.type === 'user') return fullName(o.sender_user) || 'کاربر';
  if (o.type === 'hidden_user') return o.sender_user_name || 'کاربر';
  if (o.type === 'chat') return (o.sender_chat && o.sender_chat.title) || 'چت';
  if (o.type === 'channel') return (o.chat && o.chat.title) || 'کانال';
  return 'ناشناس';
}

async function handleCommand(msg, text, bizId, senderName, st) {
  const chatId = msg.chat.id;
  const cmd = text.split(/\s+/)[0].split('@')[0].toLowerCase();
  const rest = text.slice(text.split(/\s+/)[0].length).trim();
  let reply = '';
  if (cmd === '/start') {
    reply = 'سلام! 👋 این دستیار هوشمنده. پیامت رو بنویس تا جواب بدم.\nاگه می‌خوای پیامت مستقیم به صاحب برسه: /send_msg متن پیام';
  } else if (cmd === '/send_msg') {
    if (!rest) {
      reply = 'بعد از دستور، پیامت رو بنویس. مثلاً:\n/send_msg سلام، کارت دارم';
    } else {
      const body = `📨 پیام برای صاحب از ${senderName} (آیدی ${msg.from ? msg.from.id : chatId}):\n\n${rest}`;
      let ok = false;
      if (st.admin_group_id) { try { await api.sendMessage({ chat_id: Number(st.admin_group_id), text: clip(body, 3500) }); ok = true; } catch (e) { /* ignore */ } }
      if (!ok) { await notifyMembers(body, { silentChat: true }); }
      reply = 'پیامت ارسال شد ✅';
    }
  } else {
    reply = 'این دستور رو نمی‌شناسم. فقط /start و /send_msg رو دارم.';
  }
  const sent = await sendText({ chatId, text: reply, bizId, markdown: false });
  await addMessage({ chatId, msgId: sent.message_id, role: 'bot_auto', sender: 'ربات', text: reply, ts: now(), senderMode: bizId ? 'me' : 'bot' });
  await touchChat(chatId, { lastText: clip(reply, 200), lastSender: 'ربات', lastTs: now() });
}

// ورودی مشترک پیام‌های دریافتی (چت بیزینس، پیام مستقیم به ربات، گروه)
export async function ingest(msg) {
  const st = await getSettings();
  const chat = msg.chat;
  const chatId = chat.id;
  const bizId = msg.business_connection_id || null;
  const from = msg.from || {};
  const isGroup = chat.type === 'group' || chat.type === 'supergroup';

  // تکراری‌ها (retry تلگرام)
  if (await findByTg(chatId, msg.message_id)) return;

  const ownerId = bizId ? await ownerOf(bizId) : null;
  const isOwner = !!ownerId && from.id === ownerId;
  const senderName = fullName(from) || chat.title || 'مخاطب';
  const chatName = (isGroup || chat.type === 'channel') ? chat.title : fullName(chat);

  const info = describeMedia(msg);
  let text = msg.text || msg.caption || '';
  if (!text && info) text = info.ph;
  if (!text && !info) return;

  if (info) await archiveMedia(info, st);

  const rp = replyInfo(msg);
  const role = isOwner ? 'owner' : 'user';
  await addMessage({
    chatId, msgId: msg.message_id, role, sender: isOwner ? 'شما' : senderName, senderId: from.id,
    text, type: info ? info.type : null, fileId: info ? info.fileId : null, mediaKey: info ? info.key : null,
    replyToMsgId: rp.replyToMsgId, replyPreview: rp.replyPreview, forwardedFrom: forwardedFrom(msg),
    ts: (msg.date ? msg.date * 1000 : now()),
  });

  await touchChat(chatId, {
    title: (!isOwner && (chatName || senderName)) || undefined,
    kind: chat.type, isGroup,
    bizId: bizId || undefined,
    hasBotChat: bizId ? undefined : true,
    lastText: clip(text, 200), lastSender: isOwner ? 'شما' : senderName, lastTs: now(),
  });

  if (isOwner) return;                       // پیام خودت: نه اعلان، نه AI

  const chatRow = await getChat(chatId);

  // دستورها
  if (text.startsWith('/') && !info) {
    try { await handleCommand(msg, text, bizId, senderName, st); }
    catch (e) { await alertAdmins('خطا در اجرای دستور: ' + (e && e.message)); }
    await notifyMembers(`💬 ${chatRow.title}\n${senderName}: ${clip(text, 300)}`, { chat: chatRow });
    return;
  }

  await notifyMembers(`💬 ${chatRow.title}\n${senderName}: ${clip(text, 300)}`, { chat: chatRow });

  if (!aiEnabled(chatRow, st)) return;

  const myRow = await findByTg(chatId, msg.message_id);
  if (!myRow) return;
  const delay = Math.max(1, Number(st.ai_delay_seconds) || 28);
  await touchChat(chatId, { aiPendingUntil: now() + delay * 1000 + 8000 });
  await sleep(delay * 1000);                 // ← بخش «تایمر ۲۸ ثانیه‌ای»
  await runAi({ chatId, rowId: myRow.id, bizId, st: await getSettings() });
}
