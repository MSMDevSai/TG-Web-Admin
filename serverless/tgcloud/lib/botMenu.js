import { api, db } from 'sdk';
import { and, asc, desc, eq } from 'sdk/db';
import {
  anonLinks, anonMessages, anonReports, botUsers, userBlocks, contactRequests, members, uiState,
} from '../schema.js';
import { getSettings, saveSettings, memberRole, getSettingsFor, getMemberSettings } from './store.js';
import { getCounters, anonStats, bump, fmtNum } from './stats.js';
import {
  setBlock, removeBlock, warnUser, setUiState, clearUiState, filterWords, blockedMessage, getUiState,
} from './moderation.js';
import { WEBAPP_URL } from './config.js';
import { now, clip, fullName } from './util.js';

const say = (chatId, text, extra) => api.sendMessage({ chat_id: chatId, text, ...(extra || {}) });

// متن‌های بلند را تکه‌تکه می‌فرستد (محدودیت ۴۰۹۶ کاراکتر تلگرام).
async function sendLong(chatId, text, extra) {
  const body = String(text || '');
  for (let i = 0; i < body.length; i += 3800) {
    await say(chatId, body.slice(i, i + 3800), i === 0 ? extra : undefined);
  }
}

function btn(text, data) { return { text, callback_data: data }; }
function rows(...r) { return { inline_keyboard: r }; }
const back = btn('⬅️ منوی اصلی', 'bm:back');

const HELP = `📖 راهنمای ربات

🤖 دستورهای عمومی
/start — شروع و منوی اصلی
/menu — منوی دکمه‌های شیشه‌ای
/help — همین راهنما
/settings — تنظیمات دکمه‌ای
/notify on|off — روشن/خاموش کردن اعلان پیام‌ها
/key — راهنمای ثبت کلید Google AI Studio
/panel — باز کردن پنل مدیریت
/anon — لینک پیام ناشناس
/stop — خروج از حالت پیام ناشناس
/contact <متن> — درخواست/اعتراض به ادمین
/send_msg <متن> — پیام به ادمین

🛡 دستورهای ادمین
/stats — آمار ربات
/setgroup — ثبت همین گروه به‌عنوان گروه ادمین
/block <id> [دلیل] — بلاک موقت
/blockp <id> [دلیل] — بلاک دائمی
/unblock <id> — رفع بلاک
/warn <id> <دلیل> — ارسال اخطار
/filter <کلمه۱, کلمه۲> — تنظیم کلمات ممنوعه و روشن کردن فیلتر
/filteroff — خاموش کردن فیلتر`;

export async function helpText() { return HELP; }

// ───────── منوی اصلی ─────────
export async function sendBotMenu(chatId, { role = null, name = '' } = {}) {
  const admin = role === 'admin';
  const kb = admin
    ? rows(
        [btn('📊 آمار', 'bm:stats'), btn('⚙️ تنظیمات', 'bm:set:root')],
        [btn('📇 مخاطبین ربات', 'bm:users:0'), btn('🚫 بلاک‌شده‌ها', 'bm:blocks')],
        [btn('🚩 گزارش‌ها', 'bm:reports'), btn('📨 درخواست‌های تماس', 'bm:contacts')],
        [btn('🕶 پیام ناشناس من', 'bm:anon'), btn('❓ راهنما', 'bm:help')],
      )
    : rows(
        role
          ? [btn('🤖 کلید و تنظیمات AI', 'bm:myai'), btn('🔔 اعلان من', 'bm:mynotify')]
          : [btn('🤖 کلید و تنظیمات AI', 'bm:myai')],
        [btn('🕶 پیام ناشناس من', 'bm:anon')],
        [btn('📞 تماس با ادمین', 'bm:contacthelp'), btn('❓ راهنما', 'bm:help')],
      );
  const text = admin
    ? `👋 ${name || 'ادمین'} عزیز\nاز منوی زیر بخش موردنظر را انتخاب کن.`
    : `👋 ${name || 'دوست عزیز'}\nاز منوی زیر انتخاب کن.`;
  return say(chatId, text, { reply_markup: kb });
}

// ───────── صفحه‌های تنظیمات ─────────
async function setRoot(st, admin) {
  const kb = admin
    ? rows(
        [btn('🤖 هوش مصنوعی', 'bm:set:ai'), btn('🔔 اعلان‌ها', 'bm:set:notify')],
        [btn('🕶 پیام ناشناس', 'bm:set:anon'), btn('🗄 آرشیو رسانه', 'bm:set:archive')],
        [btn('🚫 فیلتر کلمات', 'bm:set:filter'), btn('👥 گروه ادمین', 'bm:set:group')],
        [back],
      )
    : rows(
        [btn('🤖 کلید و تنظیمات AI', 'bm:myai'), btn('🔔 اعلان من', 'bm:mynotify')],
        [back],
      );
  return {
    text: `⚙️ تنظیمات ربات\n\nAI: ${st.ai_mode ? 'روشن' : 'خاموش'} · اعلان‌ها: ${st.notify_enabled ? 'روشن' : 'خاموش'}\n` +
      `ناشناس: ${st.anon_enabled ? 'روشن' : 'خاموش'} · فیلتر: ${st.filter_enabled ? 'روشن' : 'خاموش'}\n` +
      `مدل: ${st.gemini_model}`,
    kb,
  };
}

function toggleLabel(on) { return on ? '🟢 روشن' : '🔴 خاموش'; }

async function setAi(st) {
  const kb = rows(
    [btn(`✨ هوش مصنوعی: ${toggleLabel(st.ai_mode)}`, 'bm:t:ai_mode')],
    [btn(`🔑 اشتراک کلید پیش‌فرض: ${toggleLabel(st.share_gemini_key)}`, 'bm:t:share_gemini_key')],
    [btn(`🧠 ${st.gemini_model}`, 'bm:noop')],
    [btn('flash-2.5', 'bm:p:gemini_model:gemini-2.5-flash'), btn('pro-2.5', 'bm:p:gemini_model:gemini-2.5-pro')],
    [btn('flash-2.0', 'bm:p:gemini_model:gemini-2.0-flash')],
    [btn(`⏱ تأخیر: ${st.ai_delay_seconds} ثانیه`, 'bm:noop')],
    [btn('۱۰', 'bm:p:ai_delay_seconds:10'), btn('۲۸', 'bm:p:ai_delay_seconds:28'), btn('۶۰', 'bm:p:ai_delay_seconds:60')],
    [btn('📱 کلید/پرامپت در پنل', 'bm:panel')],
    [btn('⬅️ تنظیمات', 'bm:set:root')],
  );
  return { text: `🤖 هوش مصنوعی\n\nوضعیت: ${st.ai_mode ? 'روشن' : 'خاموش'}\nمدل پیش‌فرض: ${st.gemini_model}\n` +
    `کلید پیش‌فرض: ${st.gemini_api_key ? 'ثبت شده' : 'ثبت نشده'}\n` +
    `تأخیر پاسخ: ${st.ai_delay_seconds} ثانیه\n` +
    `اشتراک کلید با اعضا: ${st.share_gemini_key ? 'بله' : 'خیر'}\n\n` +
    'برای پرامپت و کلید دقیق‌تر از پنل استفاده کن.', kb };
}

async function setNotify(st) {
  const kb = rows(
    [btn(`🔔 اعلان کلی: ${toggleLabel(st.notify_enabled)}`, 'bm:t:notify_enabled')],
    [btn(`🗑 اعلان حذف پیام: ${toggleLabel(st.notify_deleted)}`, 'bm:t:notify_deleted')],
    [btn('👥 گروه ادمین', 'bm:set:group')],
    [btn('⬅️ تنظیمات', 'bm:set:root')],
  );
  return { text: `🔔 اعلان‌ها\n\nاعلان کلی پیام‌های جدید: ${st.notify_enabled ? 'روشن' : 'خاموش'}\n` +
    `اعلان وقتی مخاطب پیام پاک می‌کند: ${st.notify_deleted ? 'روشن' : 'خاموش'}\n\n` +
    'هشدارها، خطاها، گزارش‌ها و بازیابی رمز همیشه برای ادمین‌ها و گروه ادمین ارسال می‌شوند.', kb };
}

async function setAnon(st) {
  const kb = rows(
    [btn(`🕶 پیام ناشناس: ${toggleLabel(st.anon_enabled)}`, 'bm:t:anon_enabled')],
    [btn(`📨 سقف ساعتی: ${st.anon_rate_per_hour}`, 'bm:noop')],
    [btn('۱۰', 'bm:p:anon_rate_per_hour:10'), btn('۳۰', 'bm:p:anon_rate_per_hour:30'), btn('۶۰', 'bm:p:anon_rate_per_hour:60')],
    [btn('📊 آمار ناشناس', 'bm:anonstats')],
    [btn('⬅️ تنظیمات', 'bm:set:root')],
  );
  return { text: `🕶 پیام ناشناس\n\nوضعیت کلی: ${st.anon_enabled ? 'روشن' : 'خاموش'}\n` +
    `سقف پیام هر فرستنده در ساعت: ${st.anon_rate_per_hour}\n` +
    `نگهداری سابقه: ${st.anon_retention_days} روز`, kb };
}

async function setArchive(st) {
  const kb = rows(
    [btn(`🗄 آرشیو رسانه: ${toggleLabel(st.archive_media)}`, 'bm:t:archive_media')],
    [btn(`🎥 ویدیو مسیج: ${toggleLabel(st.archive_video_note)}`, 'bm:t:archive_video_note')],
    [btn(`📦 سقف حجم: ${st.archive_max_mb}MB`, 'bm:noop')],
    [btn('۵', 'bm:p:archive_max_mb:5'), btn('۱۰', 'bm:p:archive_max_mb:10'), btn('۲۰', 'bm:p:archive_max_mb:20')],
    [btn('⬅️ تنظیمات', 'bm:set:root')],
  );
  return { text: `🗄 آرشیو رسانه\n\nذخیرهٔ رسانه‌ها: ${st.archive_media ? 'روشن' : 'خاموش'}\n` +
    `ذخیرهٔ بایت ویدیو مسیج: ${st.archive_video_note ? 'روشن' : 'خاموش'}\n` +
    `سقف حجم هر فایل: ${st.archive_max_mb} مگابایت`, kb };
}

async function setFilter(st) {
  const words = filterWords(st);
  const kb = rows(
    [btn(`🚫 فیلتر خودکار: ${toggleLabel(st.filter_enabled)}`, 'bm:t:filter_enabled')],
    [btn('➕ افزودن کلمه', 'bm:addfilter'), btn('🧹 پاک کردن همه', 'bm:filterclear')],
    [btn('✏️ ویرایش در پنل', 'bm:panel')],
    [btn('⬅️ تنظیمات', 'bm:set:root')],
  );
  return { text: `🚫 فیلتر کلمات ممنوعه\n\nوضعیت: ${st.filter_enabled ? 'روشن' : 'خاموش'}\n` +
    `تعداد کلمات: ${words.length}\n` +
    (words.length ? `\nنمونه: ${words.slice(0, 20).join('، ')}` : '') +
    '\n\nوقتی کلمه‌ای پیدا شود، به کاربر اخطار می‌رود و به ادمین‌ها گزارش می‌شود.', kb };
}

async function setGroup(st) {
  const k = [
    [btn('🔄 ثبت گروه با /setgroup', 'bm:grouphelp')],
  ];
  if (st.admin_group_id) k.push([btn('🗑 حذف گروه ادمین', 'bm:groupclear')]);
  k.push([btn('⬅️ تنظیمات', 'bm:set:root')]);
  return { text: `👥 گروه ادمین\n\nشناسه فعلی: ${st.admin_group_id || 'ثبت نشده'}\n\n` +
    'ربات را به گروه موردنظر اضافه کن و در همان گروه دستور /setgroup را بفرست. ' +
    'همهٔ هشدارها، خطاها، گزارش‌ها و درخواست‌های تماس به این گروه هم ارسال می‌شوند.', kb: rows(...k) };
}

async function statsPage() {
  const c = await getCounters();
  const a = await anonStats(0);
  const users = await db.$count(botUsers);
  const blocks = await db.$count(userBlocks);
  const reports = await db.$count(anonReports, eq(anonReports.status, 'open'));
  const contacts = await db.$count(contactRequests, eq(contactRequests.handled, false));
  const text = `📊 آمار ربات\n\n` +
    `👥 کاربران بات: ${fmtNum(users)}\n` +
    `💬 پیام دریافتی: ${fmtNum(c.messages_in || 0)}\n` +
    `📤 پیام ارسالی: ${fmtNum(c.messages_out || 0)}\n` +
    `🤖 درخواست AI: ${fmtNum(c.ai_requests || 0)}\n` +
    `⚠️ خطای AI: ${fmtNum(c.ai_errors || 0)}\n` +
    `❗ خطای کل: ${fmtNum(c.errors_total || 0)}\n\n` +
    `🕶 پیام ناشناس\n` +
    `لینک‌ها: ${fmtNum(a.links)} (فعال ${fmtNum(a.activeLinks)})\n` +
    `بازدید: ${fmtNum(a.views)} · فرستنده: ${fmtNum(a.senders)}\n` +
    `دریافتی: ${fmtNum(a.incoming)} · ارسالی: ${fmtNum(a.outgoing)}\n` +
    `۲۴ ساعت اخیر: ${fmtNum(a.last24h)}\n\n` +
    `🚫 بلاک‌شده: ${fmtNum(blocks)} · 🚩 گزارش باز: ${fmtNum(reports)} · 📨 تماس باز: ${fmtNum(contacts)}`;
  const kb = rows([btn('🔄 بروزرسانی', 'bm:stats')], [btn('📱 آمار کامل در پنل', 'bm:panel')], [back]);
  return { text, kb };
}

// ───────── لینک ناشناس کاربر ─────────
async function anonPage(uid, st) {
  const l = await db.select().from(anonLinks).where(eq(anonLinks.ownerId, uid)).get();
  if (!st.anon_enabled) return { text: '🕶 قابلیت پیام ناشناس توسط ادمین خاموش شده است.', kb: rows([back]) };
  if (!l) return { text: '🕶 هنوز لینکی نساخته‌ای.', kb: rows([btn('➕ ساخت لینک', 'bm:anonnew')], [back]) };
  let user = st.bot_username;
  if (!user) { try { const me = await api.getMe(); user = me.username; await saveSettings({ bot_username: user }); } catch (e) { /* ignore */ } }
  const url = user ? `https://t.me/${user}?start=anon_${l.token}` : '';
  const a = await anonStats(uid);
  const text = `🕶 لینک پیام ناشناس تو\n${url || '(نام کاربری ربات در دسترس نیست)'}\n\n` +
    `وضعیت: ${l.enabled ? 'روشن' : 'خاموش'}\nبازدید: ${fmtNum(a.views)} · فرستنده: ${fmtNum(a.senders)}\n` +
    `دریافتی: ${fmtNum(a.incoming)} · ارسالی: ${fmtNum(a.outgoing)}`;
  const kb = rows(
    [btn(l.enabled ? '⛔ خاموش کردن' : '✅ روشن کردن', 'bm:anontoggle'), btn('🔄 لینک جدید', 'bm:anonnew')],
    [back],
  );
  return { text, kb };
}

async function myAiPage(uid) {
  const s = await getSettingsFor(uid);
  const row = await getMemberSettings(uid);
  const own = !!(row && String(row.geminiApiKey || '').trim());
  const text = `🤖 تنظیمات AI من\n\nمدل مؤثر: ${s.gemini_model}\nکلید: ${own ? 'اختصاصی ✅' : (s.gemini_api_key ? 'کلید پیش‌فرض ادمین' : 'ثبت نشده')}\n` +
    'برای ثبت کلید، آن را در همین چت بفرست یا از دکمهٔ پنل استفاده کن.';
  const kb = rows(
    [btn('📱 باز کردن تنظیمات در پنل', 'bm:panel')],
    [btn('🔑 راهنمای کلید', 'bm:keyhelp')],
    [back],
  );
  return { text, kb };
}

// ───────── لیست‌ها ─────────
async function usersPage(offset = 0) {
  offset = Math.max(0, Number(offset) || 0);
  const list = await db.select().from(botUsers).orderBy(desc(botUsers.lastSeen)).limit(8).offset(offset).all();
  if (!list.length) return { text: '📇 هنوز کسی به بات پیام نداده است.', kb: rows([btn('⬅️ منوی اصلی', 'bm:back')]) };
  const kb = list.map((u) => [btn(`${u.name || u.tgId} · ${u.tgId}`, `bm:u:${u.tgId}`)]);
  kb.push([btn('⬅️ بعدی', `bm:users:${offset + 8}`), btn('منوی اصلی', 'bm:back')]);
  return { text: `📇 مخاطبین ربات (${offset + 1} تا ${offset + list.length})\n\nیکی را انتخاب کن:`, kb };
}

async function userCard(tgId) {
  const id = Number(tgId);
  const u = await db.select().from(botUsers).where(eq(botUsers.tgId, id)).get();
  const b = await db.select().from(userBlocks).where(eq(userBlocks.tgId, id)).get();
  const text = `👤 ${u ? (u.name || u.tgId) : id}\n` +
    `آیدی: ${id}\n` + (u && u.username ? `یوزرنیم: @${u.username}\n` : '') +
    (u && u.lastText ? `آخرین پیام: ${clip(u.lastText, 200)}\n` : '') +
    (b ? `\n🚫 بلاک: ${b.permanent ? 'دائمی' : 'موقت'}${b.reason ? '\nدلیل: ' + b.reason : ''}` : '\n✅ بلاک نیست');
  const kb = rows(
    [btn('📤 ارسال پیام', `bm:dm:${id}`), btn('⚠️ اخطار', `bm:warn:${id}`)],
    b
      ? [btn('✅ رفع بلاک', `bm:unblock:${id}`)]
      : [btn('🚫 بلاک موقت', `bm:block:${id}:0`), btn('⛔ بلاک دائمی', `bm:block:${id}:1`)],
    [btn('⬅️ مخاطبین', 'bm:users:0'), btn('منوی اصلی', 'bm:back')],
  );
  return { text, kb };
}

async function blocksPage() {
  const list = await db.select().from(userBlocks).orderBy(desc(userBlocks.ts)).limit(20).all();
  if (!list.length) return { text: '🚫 هیچ کاربری بلاک نشده است.', kb: rows([back]) };
  const kb = list.map((b) => [btn(`${b.tgId}${b.permanent ? ' (دائمی)' : ''} · ${clip(b.reason || '—', 30)}`, `bm:unblock:${b.tgId}`)]);
  kb.push([back]);
  return { text: '🚫 کاربران بلاک‌شده (برای رفع بلاک بزن):', kb };
}

async function reportsPage() {
  const list = await db.select().from(anonReports).orderBy(desc(anonReports.id)).limit(10).all();
  if (!list.length) return { text: '🚩 گزارشی ثبت نشده است.', kb: rows([back]) };
  const kb = list.map((r) => [btn(`#${r.id} · فرستنده ${r.senderId}`, `bm:report:${r.id}`)]);
  kb.push([back]);
  return { text: '🚩 گزارش‌های پیام ناشناس (برای دیدن گفتگو بزن):', kb };
}

async function contactPage() {
  const list = await db.select().from(contactRequests).where(eq(contactRequests.handled, false)).orderBy(desc(contactRequests.id)).limit(10).all();
  if (!list.length) return { text: '📨 درخواست تماس باز وجود ندارد.', kb: rows([back]) };
  const kb = list.map((c) => [btn(`${c.tgId} · ${clip(c.text, 28)}`, `bm:contact:${c.id}`)]);
  kb.push([back]);
  return { text: '📨 درخواست‌های تماس (برای دیدن متن بزن):', kb };
}

async function conversation(ownerId, senderId, reason = '') {
  const rowsMsg = await db.select().from(anonMessages)
    .where(and(eq(anonMessages.ownerId, ownerId), eq(anonMessages.senderId, senderId)))
    .orderBy(asc(anonMessages.id)).limit(200).all();
  let body = rowsMsg.map((m) => {
    const who = m.dir === 'in' ? '👤 ناشناس' : '🧑 مالک';
    return `${who}: ${m.text || (m.kind ? `[${m.kind}]` : '[بدون متن]')}`;
  }).join('\n');
  if (!body) body = '(متن گفتگو در دسترس نیست؛ احتمالاً قبل از این نسخه ثبت شده یا بر اساس نگهداری پاک شده است.)';
  const head = `🗂 کل گفتگوی ناشناس\nمالک: ${ownerId}\nفرستنده: ${senderId}\n` +
    (reason ? `دلیل گزارش: ${reason}\n` : '') + '\n';
  return head + body;
}

// ───────── هندل دکمه‌ها ─────────
export async function botMenuCallback(cq) {
  const data = String(cq.data || '');
  if (!data.startsWith('bm:')) return false;
  const uid = Number(cq.from.id);
  const chatId = cq.message ? cq.message.chat.id : uid;
  const answer = (text) => api.answerCallbackQuery({ callback_query_id: cq.id, text }).catch(() => {});
  const role = await memberRole(uid);
  const admin = role === 'admin';
  const st = await getSettings();
  const parts = data.split(':');
  const act = parts[1] || '';
  const arg = parts[2] || '';
  const arg2 = parts[3] || '';

  if (act === 'noop') { await answer(''); return true; }
  if (act === 'help') { await answer(''); await sendLong(chatId, HELP, { reply_markup: rows([back]) }); return true; }
  if (act === 'contacthelp') { await answer(''); await say(chatId, 'برای تماس با ادمین بنویس:\n/contact متن پیامت', { reply_markup: rows([back]) }); return true; }
  if (act === 'keyhelp') { await answer(''); await say(chatId, 'کلید Google AI Studio را از aistudio.google.com/apikey بگیر و همین‌جا بفرست (AIza...).', { reply_markup: rows([back]) }); return true; }
  if (act === 'panel') {
    await answer('');
    if (!WEBAPP_URL) return true;
    await say(chatId, '📱 پنل را باز کن:', { reply_markup: rows([{ text: 'باز کردن پنل', web_app: { url: WEBAPP_URL } }]) });
    return true;
  }
  if (act === 'cancel') { await clearUiState(uid); await answer('لغو شد'); return true; }

  // ── بخش‌های ادمین ──
  if (!admin && !['myai', 'mynotify', 'anon', 'anontoggle', 'anonnew', 'anonstats'].includes(act)) {
    await answer('این بخش فقط برای ادمین است.');
    return true;
  }

  if (act === 'stats') { const p = await statsPage(); await answer(''); await sendLong(chatId, p.text, { reply_markup: p.kb }); return true; }
  if (act === 'set') {
    let page;
    if (arg === 'ai') page = await setAi(st);
    else if (arg === 'notify') page = await setNotify(st);
    else if (arg === 'anon') page = await setAnon(st);
    else if (arg === 'archive') page = await setArchive(st);
    else if (arg === 'filter') page = await setFilter(st);
    else if (arg === 'group') page = await setGroup(st);
    else page = await setRoot(st, true);
    await answer(''); await say(chatId, page.text, { reply_markup: page.kb }); return true;
  }
  if (act === 't') {
    const key = arg;
    const allowed = ['ai_mode', 'notify_enabled', 'notify_deleted', 'anon_enabled', 'archive_media', 'archive_video_note', 'share_gemini_key', 'filter_enabled'];
    if (!allowed.includes(key)) { await answer('تنظیم نامعتبر'); return true; }
    await saveSettings({ [key]: !st[key] });
    const fresh = await getSettings();
    const page = key.startsWith('ai') || key === 'share_gemini_key' ? await setAi(fresh)
      : key.startsWith('notify') ? await setNotify(fresh)
      : key.startsWith('anon') ? await setAnon(fresh)
      : key.startsWith('archive') ? await setArchive(fresh)
      : await setFilter(fresh);
    await answer('ذخیره شد ✅');
    if (cq.message) { try { await api.editMessageText({ chat_id: chatId, message_id: cq.message.message_id, text: page.text, reply_markup: page.kb }); } catch (e) { await say(chatId, page.text, { reply_markup: page.kb }); } }
    return true;
  }
  if (act === 'p') {
    const key = arg, value = arg2;
    const allowed = {
      gemini_model: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
      ai_delay_seconds: ['10', '28', '60'],
      anon_rate_per_hour: ['10', '30', '60'],
      anon_retention_days: ['7', '30', '90'],
      archive_max_mb: ['5', '10', '20'],
    };
    if (!allowed[key] || !allowed[key].includes(value)) { await answer('مقدار نامعتبر'); return true; }
    const num = ['ai_delay_seconds', 'anon_rate_per_hour', 'anon_retention_days', 'archive_max_mb'].includes(key);
    await saveSettings({ [key]: num ? Number(value) : value });
    await answer('ذخیره شد ✅');
    const fresh = await getSettings();
    const page = key === 'gemini_model' || key === 'ai_delay_seconds' ? await setAi(fresh)
      : key === 'archive_max_mb' ? await setArchive(fresh)
      : await setAnon(fresh);
    if (cq.message) { try { await api.editMessageText({ chat_id: chatId, message_id: cq.message.message_id, text: page.text, reply_markup: page.kb }); } catch (e) { await say(chatId, page.text, { reply_markup: page.kb }); } }
    return true;
  }
  if (act === 'groupclear') { await saveSettings({ admin_group_id: '' }); await answer('گروه ادمین حذف شد'); const p = await setGroup({ ...st, admin_group_id: '' }); await say(chatId, p.text, { reply_markup: p.kb }); return true; }
  if (act === 'grouphelp') { await answer(''); await say(chatId, 'ربات را به گروه اضافه کن و در همان گروه /setgroup بفرست.'); return true; }
  if (act === 'filterclear') { await saveSettings({ banned_words: '' }); await answer('کلمات پاک شد'); const p = await setFilter({ ...st, banned_words: '' }); await say(chatId, p.text, { reply_markup: p.kb }); return true; }
  if (act === 'addfilter') {
    await setUiState(uid, 'addfilter');
    await answer('');
    await say(chatId, 'کلمه یا کلمات ممنوعه را بنویس (با کاما یا خط جدید جدا کن).', { reply_markup: rows([btn('لغو', 'bm:cancel')]) });
    return true;
  }
  if (act === 'users') { const p = await usersPage(Number(arg) || 0); await answer(''); await say(chatId, p.text, { reply_markup: p.kb }); return true; }
  if (act === 'u') { const p = await userCard(Number(arg)); await answer(''); await say(chatId, p.text, { reply_markup: p.kb }); return true; }
  if (act === 'blocks') { const p = await blocksPage(); await answer(''); await say(chatId, p.text, { reply_markup: p.kb }); return true; }
  if (act === 'reports') { const p = await reportsPage(); await answer(''); await say(chatId, p.text, { reply_markup: p.kb }); return true; }
  if (act === 'contacts') { const p = await contactPage(); await answer(''); await say(chatId, p.text, { reply_markup: p.kb }); return true; }
  if (act === 'report') {
    const id = Number(arg);
    const r = await db.select().from(anonReports).where(eq(anonReports.id, id)).get();
    if (!r) { await answer('گزارش پیدا نشد'); return true; }
    await answer('');
    await sendLong(chatId, await conversation(r.ownerId, r.senderId, r.reason), {
      reply_markup: rows(
        [btn('🚫 بلاک فرستنده', `bm:block:${r.senderId}:0`), btn('⛔ بلاک دائمی', `bm:block:${r.senderId}:1`)],
        [btn('✅ رسیدگی شد', `bm:resolve:${r.id}`), btn('⬅️ گزارش‌ها', 'bm:reports')],
      ),
    });
    return true;
  }
  if (act === 'resolve') {
    await db.update(anonReports).set({ status: 'resolved', resolvedAt: now(), by: uid }).where(eq(anonReports.id, Number(arg))).run();
    await answer('رسیدگی ثبت شد ✅');
    return true;
  }
  if (act === 'contact') {
    const id = Number(arg);
    const c = await db.select().from(contactRequests).where(eq(contactRequests.id, id)).get();
    if (!c) { await answer('پیدا نشد'); return true; }
    await answer('');
    await sendLong(chatId, `📨 ${c.kind === 'appeal' ? 'اعتراض' : 'درخواست تماس'}\nاز: ${c.name}\nآیدی: ${c.tgId}\n\n${c.text}`, {
      reply_markup: rows(
        [btn('📤 پاسخ', `bm:dm:${c.tgId}`), btn('⚠️ اخطار', `bm:warn:${c.tgId}`)],
        [btn('✅ انجام شد', `bm:ch:${c.id}`), btn('⬅️ تماس‌ها', 'bm:contacts')],
      ),
    });
    return true;
  }
  if (act === 'ch') {
    await db.update(contactRequests).set({ handled: true }).where(eq(contactRequests.id, Number(arg))).run();
    await answer('علامت خورد ✅');
    return true;
  }
  if (act === 'dm') {
    const id = Number(arg);
    await setUiState(uid, `dm:${id}`);
    await answer('');
    await say(chatId, `متن پیام برای ${id} را بنویس:`, { reply_markup: rows([btn('لغو', 'bm:cancel')]) });
    return true;
  }
  if (act === 'warn') {
    const id = Number(arg);
    await setUiState(uid, `warn:${id}`);
    await answer('');
    await say(chatId, `دلیل اخطار برای ${id} را بنویس:`, { reply_markup: rows([btn('لغو', 'bm:cancel')]) });
    return true;
  }
  if (act === 'block') {
    const id = Number(arg);
    const perm = String(arg2) === '1';
    await setUiState(uid, `block:${id}:${perm ? 1 : 0}`);
    await answer('');
    await say(chatId, `دلیل ${perm ? 'بلاک دائمی' : 'بلاک موقت'} ${id} را بنویس:`, { reply_markup: rows([btn('لغو', 'bm:cancel')]) });
    return true;
  }
  if (act === 'unblock') {
    const id = Number(arg);
    await removeBlock(id);
    await answer('رفع بلاک شد ✅');
    const p = await userCard(id);
    await say(chatId, p.text, { reply_markup: p.kb });
    return true;
  }

  // ── بخش‌های کاربر ──
  if (act === 'myai') { const p = await myAiPage(uid); await answer(''); await say(chatId, p.text, { reply_markup: p.kb }); return true; }
  if (act === 'mynotify') {
    if (!role) { await answer('این بخش فقط برای اعضای پنل است.'); return true; }
    if (arg === 'on' || arg === 'off') {
      const on = arg === 'on';
      await db.insert(members).values({ tgId: uid, role, name: fullName(cq.from), notify: on })
        .onConflictDoUpdate({ target: members.tgId, set: { notify: on } }).run();
      await answer(on ? 'اعلان روشن شد' : 'اعلان خاموش شد');
      await say(chatId, on ? '🔔 اعلان‌ها روشن شد.' : '🔕 اعلان‌ها خاموش شد.');
      return true;
    }
    await answer('');
    await say(chatId, '🔔 اعلان پیام‌های جدید را روشن یا خاموش کن:', {
      reply_markup: rows([btn('روشن', 'bm:mynotify:on'), btn('خاموش', 'bm:mynotify:off')], [back]),
    });
    return true;
  }
  if (act === 'anon') { const p = await anonPage(uid, st); await answer(''); await say(chatId, p.text, { reply_markup: p.kb }); return true; }
  if (act === 'anontoggle') {
    const l = await db.select().from(anonLinks).where(eq(anonLinks.ownerId, uid)).get();
    if (!l) { await answer('اول لینک بساز'); return true; }
    const enabled = !l.enabled;
    await db.update(anonLinks).set({ enabled }).where(eq(anonLinks.token, l.token)).run();
    await answer(enabled ? 'روشن شد' : 'خاموش شد');
    const p = await anonPage(uid, await getSettings());
    if (cq.message) { try { await api.editMessageText({ chat_id: chatId, message_id: cq.message.message_id, text: p.text, reply_markup: p.kb }); } catch (e) { await say(chatId, p.text, { reply_markup: p.kb }); } }
    return true;
  }
  if (act === 'anonnew') {
    const old = await db.select().from(anonLinks).where(eq(anonLinks.ownerId, uid)).get();
    if (old) await db.delete(anonLinks).where(eq(anonLinks.token, old.token)).run();
    const token = randToken(16);
    await db.insert(anonLinks).values({ token, ownerId: uid, ownerName: clip(fullName(cq.from), 60), enabled: true, uses: 0, createdAt: now() }).run();
    await answer('لینک جدید ساخته شد');
    const p = await anonPage(uid, await getSettings());
    await say(chatId, p.text, { reply_markup: p.kb });
    return true;
  }
  if (act === 'anonstats') {
    const a = await anonStats(admin ? 0 : uid);
    await answer('');
    await say(chatId, `📊 آمار پیام ناشناس\n\nلینک: ${fmtNum(a.links)} (فعال ${fmtNum(a.activeLinks)})\n` +
      `بازدید: ${fmtNum(a.views)}\nفرستنده: ${fmtNum(a.senders)}\n` +
      `دریافتی: ${fmtNum(a.incoming)} · ارسالی: ${fmtNum(a.outgoing)}\n` +
      `۲۴ ساعت اخیر: ${fmtNum(a.last24h)}`, { reply_markup: rows([back]) });
    return true;
  }

  await answer('');
  return true;
}

function randToken(n) {
  const AL = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const out = []; const c = globalThis.crypto;
  if (c && c.getRandomValues) { const b = new Uint8Array(n); c.getRandomValues(b); for (let i = 0; i < n; i++) out.push(AL[b[i] % AL.length]); }
  else { for (let i = 0; i < n; i++) out.push(AL[Math.floor(Math.random() * AL.length)]); }
  return out.join('');
}

// ───────── ورودی‌های موقت ادمین ─────────
// true یعنی پیام به‌عنوان ورودی این حالت مصرف شد.
export async function handleAdminUiInput(msg) {
  const from = msg.from || {};
  const uid = Number(from.id);
  if (!uid) return false;
  const row = await getUiState(uid);
  if (!row) return false;
  const text = String(msg.text || '').trim();
  if (!text) return false;
  // دستورها حالت موقت را لغو می‌کنند (مثلاً /cancel یا /menu)
  if (text.startsWith('/')) { await clearUiState(uid); return false; }
  const role = await memberRole(uid);
  if (role !== 'admin') { await clearUiState(uid); return false; }
  const [kind, a, b] = String(row.key || '').split(':');

  if (kind === 'dm') {
    const target = Number(a);
    await clearUiState(uid);
    try {
      await api.sendMessage({ chat_id: target, text });
      try { await bump('messages_out'); } catch (e) { /* ignore */ }
      await say(uid, `✅ پیام برای ${target} ارسال شد.`);
    } catch (e) {
      await say(uid, `⚠️ ارسال نشد: ${e && e.description ? e.description : 'کاربر ربات را بلاک کرده یا استارت نزده.'}`);
    }
    return true;
  }
  if (kind === 'warn') {
    const target = Number(a);
    await clearUiState(uid);
    const r = await warnUser(target, text, { id: uid, name: fullName(from) });
    await say(uid, r.sent ? `✅ اخطار برای ${target} ارسال شد.` : `⚠️ اخطار ثبت شد ولی ارسال تلگرام نشد (کاربر ربات را بلاک کرده).`);
    return true;
  }
  if (kind === 'block') {
    const target = Number(a);
    const permanent = String(b) === '1';
    await clearUiState(uid);
    await setBlock(target, { reason: text, permanent, by: `admin:${uid}` });
    try { await api.sendMessage({ chat_id: target, text: blockedMessage({ permanent, reason: text }) }); } catch (e) { /* ignore */ }
    await say(uid, `✅ ${permanent ? 'بلاک دائمی' : 'بلاک موقت'} ${target} ثبت شد.`);
    return true;
  }
  if (kind === 'addfilter') {
    await clearUiState(uid);
    const st = await getSettings();
    const words = [...new Set([...filterWords(st), ...String(text).split(/[\n,،;]+/).map((w) => w.trim()).filter(Boolean)])].slice(0, 300);
    await saveSettings({ banned_words: words.join('\n'), filter_enabled: true });
    await say(uid, `✅ ${words.length} کلمه ثبت شد و فیلتر روشن است.`);
    return true;
  }
  return false;
}
