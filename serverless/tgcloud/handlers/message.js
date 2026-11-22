import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { ingest } from '../lib/ingest.js';
import { memberRole, getSettings, saveMemberSettings, saveSettings } from '../lib/store.js';
import { tryHandle as anonHandle } from '../lib/anon.js';
import { members } from '../schema.js';
import { now, fullName } from '../lib/util.js';
import { keyOf, keyGuide, aiKeyboard, panelKeyboard, maybeAskKey } from '../lib/aiOnboarding.js';
import {
  parseCmd, recordBotUser, getBlock, handleBlockedMessage, takeContact,
  filterHit, handleFilterHit, setBlock, removeBlock, warnUser,
} from '../lib/moderation.js';
import { sendBotMenu, helpText, handleAdminUiInput } from '../lib/botMenu.js';

// پیام‌های مستقیم به ربات. اعضای پنل منو/دستور می‌گیرن؛ بقیه مثل یک چت عادی
// ذخیره و (در صورت فعال بودن) جواب داده می‌شن.
export default async function (msg) {
  const from = msg.from || {};
  const chat = msg.chat || {};
  const text = String(msg.text || msg.caption || '').trim();
  const { cmd, arg } = parseCmd(text);

  // ─── گروه/کانال: فقط ثبت + دستور /setgroup ───
  if (chat.type !== 'private') {
    if (!from.is_bot && (cmd === '/setgroup' || cmd === '/setadmin')) {
      const role = await memberRole(from.id);
      if (role !== 'admin') {
        try { await api.sendMessage({ chat_id: chat.id, text: '⛔ فقط ادمین می‌تواند گروه ادمین را تنظیم کند.' }); } catch (e) { /* ignore */ }
        return;
      }
      await saveSettings({ admin_group_id: String(chat.id) });
      try {
        await api.sendMessage({
          chat_id: chat.id,
          text: '✅ این گروه به‌عنوان گروه ادمین ثبت شد.\nاز این به بعد خطاها، گزارش‌ها، درخواست‌های تماس و هشدارها اینجا هم ارسال می‌شوند.',
        });
      } catch (e) { /* ignore */ }
      return;
    }
    await ingest(msg);
    return;
  }

  if (from.is_bot) return;

  // ثبت در فهرست مخاطبین ربات (حتی اعضای پنل)
  await recordBotUser(from, text);

  // ─── بلاک سراسری: هیچ پیامی پردازش نمی‌شود ───
  const block = await getBlock(from.id);
  if (block) { await handleBlockedMessage(msg, block); return; }

  // ─── درخواست تماس/اعتراض (برای همه) ───
  if (cmd === '/contact' || cmd === '/appeal') { await takeContact(msg); return; }

  // ─── ورودی موقت ادمین (دلیل بلاک/اخطار/متن پیام/کلمه فیلتر) ───
  if (await handleAdminUiInput(msg)) return;

  // ─── پیام ناشناس (لینک، سشن، گزارش) ───
  if (await anonHandle(msg)) return;

  const role = await memberRole(from.id);

  // ─── ثبت کلید Google AI Studio (اعضا و غیراعضا) ───
  const key = keyOf(text);
  if (key) {
    await saveMemberSettings(from.id, { geminiApiKey: key, onboardedAt: now() });
    await api.sendMessage({
      chat_id: from.id,
      text: '✅ کلید Google AI Studio ذخیره شد.\nفقط برای پاسخ‌های AI اکانت خودت استفاده می‌شه.\n\n' +
        'برای امنیت بیشتر، همین پیامِ حاوی کلید رو از چت پاک کن.',
    });
    return;
  }

  // ─── منو و راهنمای شیشه‌ای ───
  if (cmd === '/start' || cmd === '/menu' || cmd === '/help' || cmd === '/settings') {
    if (cmd === '/help') {
      await api.sendMessage({ chat_id: from.id, text: await helpText(), reply_markup: { inline_keyboard: [[{ text: '⬅️ منوی اصلی', callback_data: 'bm:back' }]] }, disable_web_page_preview: true });
    } else {
      await sendBotMenu(from.id, { role, name: fullName(from) });
    }
    return;
  }

  if (cmd === '/panel') {
    await api.sendMessage({ chat_id: from.id, text: '📱 پنل و تنظیمات از همین‌جا باز می‌شه.', reply_markup: panelKeyboard() });
    return;
  }

  if (cmd === '/key' || cmd === '/apikey' || cmd === '/token') {
    await api.sendMessage({ chat_id: from.id, text: keyGuide(), reply_markup: aiKeyboard() });
    return;
  }

  if (cmd === '/notify' && (arg === 'on' || arg === 'off')) {
    if (!role) { await api.sendMessage({ chat_id: from.id, text: 'این دستور فقط برای اعضای پنل است.' }); return; }
    const on = arg === 'on';
    await db.insert(members).values({ tgId: from.id, role, name: fullName(from), notify: on })
      .onConflictDoUpdate({ target: members.tgId, set: { notify: on } }).run();
    await api.sendMessage({ chat_id: from.id, text: on ? '🔔 اعلان‌ها روشن شد.' : '🔕 اعلان‌ها خاموش شد. (با /notify on دوباره روشن می‌شه)' });
    return;
  }

  // ─── دستورهای ادمین ───
  if (role === 'admin' && (await adminCommand(msg, cmd, arg, from))) return;

  // ─── فیلتر کلمات ممنوعه (برای ادمین‌ها اعمال نمی‌شود) ───
  let skipAi = false;
  if (role !== 'admin') {
    const st = await getSettings();
    const hit = await filterHit(text, st);
    if (hit) { await handleFilterHit(msg, hit); skipAi = true; }
  }

  // ─── اعضای پنل: راهنمای سریع + درخواست کلید ───
  if (role) { await memberDm(msg, role); return; }

  await ingest(msg, { skipAi });
}

async function adminCommand(msg, cmd, arg, from) {
  const chatId = msg.chat.id;
  const send = (t) => api.sendMessage({ chat_id: chatId, text: t });
  const parts = String(arg || '').trim().split(/\s+/);
  const id = Number(parts[0]);
  const rest = parts.slice(1).join(' ').trim();

  if (cmd === '/stats') {
    await send('📊 آمار را از دکمهٔ «آمار» در منو ببین: /menu');
    return true;
  }
  if (cmd === '/setgroup') {
    await send('این دستور را داخل خودِ گروه بفرست (بعد از اضافه کردن ربات به گروه).');
    return true;
  }
  if (cmd === '/block' || cmd === '/blockp') {
    if (!id) { await send('استفاده: /block <آیدی> [دلیل]'); return true; }
    const permanent = cmd === '/blockp';
    await setBlock(id, { reason: rest || 'نقض قوانین', permanent, by: `admin:${from.id}` });
    try { await api.sendMessage({ chat_id: id, text: permanent ? '⛔ شما به‌طور قطعی از این ربات مسدود شده‌اید.' : `⛔ شما از این ربات مسدود شده‌اید.\nدلیل: ${rest || 'نقض قوانین'}\n\nاگر فکر می‌کنید خطایی رخ داده، با دستور\n/contact <متن پیام>\nدرخواستتان را برای ادمین بفرستید.` }); } catch (e) { /* ignore */ }
    await send(`✅ ${id} ${permanent ? 'برای همیشه' : 'موقتاً'} بلاک شد.`);
    return true;
  }
  if (cmd === '/unblock') {
    if (!id) { await send('استفاده: /unblock <آیدی>'); return true; }
    await removeBlock(id);
    await send(`✅ بلاک ${id} برداشته شد.`);
    return true;
  }
  if (cmd === '/warn') {
    if (!id || !rest) { await send('استفاده: /warn <آیدی> <دلیل>'); return true; }
    const r = await warnUser(id, rest, { id: from.id, name: fullName(from) });
    await send(r.sent ? `✅ اخطار برای ${id} ارسال شد.` : `⚠️ اخطار ثبت شد ولی ارسال تلگرام نشد.`);
    return true;
  }
  if (cmd === '/filter') {
    const words = String(arg || '').split(/[\n,،;]+/).map((w) => w.trim()).filter(Boolean);
    if (!words.length) { await send('استفاده: /filter کلمه۱, کلمه۲\nبرای خاموش کردن: /filteroff'); return true; }
    const st = await getSettings();
    const merged = [...new Set([...(String(st.banned_words || '').split(/[\n,،;]+/).map((w) => w.trim()).filter(Boolean)), ...words])].slice(0, 300);
    await saveSettings({ banned_words: merged.join('\n'), filter_enabled: true });
    await send(`✅ ${merged.length} کلمه ثبت شد و فیلتر روشن است.`);
    return true;
  }
  if (cmd === '/filteroff') {
    await saveSettings({ filter_enabled: false });
    await send('✅ فیلتر کلمات خاموش شد.');
    return true;
  }
  return false;
}

async function memberDm(msg, role) {
  const id = msg.from.id;

  // پیام عادی: منوی دکمه‌ای + (در صورت نیاز) درخواست کلید
  const st = await getSettings();
  const usingDefault = st.share_gemini_key !== false && !!String(st.gemini_api_key || '').trim();

  let out = `سلام! 👋 تو ${role === 'admin' ? 'ادمین' : 'کاربر'} این پنل هستی.\n` +
    'از منوی زیر بخش موردنظر را انتخاب کن.';
  if (usingDefault) out += '\n\nℹ️ الان از کلید پیش‌فرض ادمین برای AI استفاده می‌کنی.';

  await api.sendMessage({
    chat_id: id,
    text: out,
    reply_markup: {
      inline_keyboard: role === 'admin'
        ? [
            [{ text: '📊 آمار', callback_data: 'bm:stats' }, { text: '⚙️ تنظیمات', callback_data: 'bm:set:root' }],
            [{ text: '📇 مخاطبین ربات', callback_data: 'bm:users:0' }, { text: '🚫 بلاک‌شده‌ها', callback_data: 'bm:blocks' }],
            [{ text: '🚩 گزارش‌ها', callback_data: 'bm:reports' }, { text: '📨 درخواست‌های تماس', callback_data: 'bm:contacts' }],
            [{ text: '🕶 پیام ناشناس من', callback_data: 'bm:anon' }, { text: '❓ راهنما', callback_data: 'bm:help' }],
          ]
        : [
            [{ text: '🤖 کلید و تنظیمات AI', callback_data: 'bm:myai' }, { text: '🔔 اعلان من', callback_data: 'bm:mynotify' }],
            [{ text: '🕶 پیام ناشناس من', callback_data: 'bm:anon' }],
            [{ text: '❓ راهنما', callback_data: 'bm:help' }],
          ],
    },
    disable_web_page_preview: true,
  });

  // اولین پیام/هر ۷ روز: درخواست کلید اختصاصی (کلید هرگز از پنل برنمی‌گردد).
  try { await maybeAskKey(id); } catch (e) { /* ربات بلاک شده یا شبکه */ }
}
