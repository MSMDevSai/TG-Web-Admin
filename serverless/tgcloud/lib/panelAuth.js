// احراز هویت پنل با یوزرنیم/پسورد (برای دسترسی خارج از تلگرام)
import { db } from 'sdk';
import { eq, and } from 'sdk/db';
import { panelUsers, panelSessions, panelResetTokens } from '../schema.js';
import { now } from './util.js';
import { EndpointError } from 'sdk';
import { api } from 'sdk';
import { notifyMembers } from './notify.js';
import { BOOTSTRAP_ADMINS } from './config.js';

const SALT_LEN = 16;
const PBKDF2_ITER = 100000;
const KEY_LEN = 32;

// رمزنگاری رمز عبور (PBKDF2 با Symbolic—بدون crypto.subs؟ در isolate ربما lacks؛ ساده می‌کنیم)
// اگر crypto.subtle موجود است از آن استفاده می‌کنیم، وern否则 fallback ساده
async function sha256(msg) {
  const crypto = globalThis.crypto;
  if (crypto && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // fallback بسیار ساده (نه Criptographically-secure، فقط برای fallback)
  let hash = 0;
  for (let i = 0; i < msg.length; i++) {
    const c = msg.charCodeAt(i);
    hash = ((hash << 5) - hash) + c;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

async function hashPassword(password, salt) {
  return sha256(password + ':' + salt);
}

function makeSalt() {
  const crypto = globalThis.crypto;
  if (crypto && crypto.getRandomValues) {
    const arr = new Uint8Array(SALT_LEN);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return Math.random().toString(36).slice(2);
}

function makeToken() {
  const crypto = globalThis.crypto;
  if (crypto && crypto.getRandomValues) {
    const arr = new Uint8Array(24);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// قوانین نام کاربری
const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

// یوزر 어دمین اولیه از BOOTSTRAP_ADMINS (اگر در panel_users نیست، ساخته می‌شود)
export async function ensureBootstrapUser() {
  for (const id of BOOTSTRAP_ADMINS) {
    const ex = await db.select().from(panelUsers).where(eq(panelUsers.telegramId, id)).get();
    if (!ex) {
      const salt = makeSalt();
      const hash = await hashPassword('admin' + id, salt);
      await db.insert(panelUsers).values({
        username: 'admin_' + id,
        passwordHash: hash,
        salt,
        telegramId: id,
        role: 'admin',
        suspended: false,
        createdAt: now(),
      }).run();
    }
  }
}

// لاگین با یوزرنیم و رمز
export async function loginWithPassword(username, password, deviceInfo) {
  username = (username || '').trim();
  if (!USERNAME_RE.test(username)) throw new EndpointError('یوزرنیم نامعتبر است.', { code: 'BAD_USERNAME' });
  if (!password || password.length < 6) throw new EndpointError('رمز عبور باید حداقل ۶ کاراکتر باشد.', { code: 'BAD_PASSWORD' });

  const user = await db.select().from(panelUsers).where(eq(panelUsers.username, username)).get();
  if (!user) throw new EndpointError('یوزرنیم یا رمز عبور اشتباه است.', { code: 'INVALID_CREDENTIALS' });
  if (user.suspended) throw new EndpointError('این یوزر تعلیق شده است. با مدیریت تماس بگیرید.', { code: 'SUSPENDED' });

  const salt = user.salt || '';
  const expected = await hashPassword(password, salt);
  if (expected !== user.passwordHash) throw new EndpointError('یوزرنیم یا رمز عبور اشتباه است.', { code: 'INVALID_CREDENTIALS' });

  //以前的 sessions را نپاک می‌کنیم (چند دستگاه مجاز است)
  const token = makeToken();
  await db.insert(panelSessions).values({
    token, username,
    deviceName: deviceInfo?.deviceName || 'مرورگر',
    platform: deviceInfo?.platform || 'web',
    createdAt: now(),
    lastSeen: now(),
  }).run();

  return {
    token,
    is_owner: BOOTSTRAP_ADMINS.includes(user.telegramId),
    role: user.role,
    username: user.username,
    telegramId: user.telegramId,
    must_change: false,
  };
}

// احراز هویت با توکن جلسه
export async function authenticateSession(token) {
  if (!token) return null;
  const sess = await db.select().from(panelSessions).where(eq(panelSessions.token, token)).get();
  if (!sess) return null;
  const user = await db.select().from(panelUsers).where(eq(panelUsers.username, sess.username)).get();
  if (!user || user.suspended) return null;
  await db.update(panelSessions).set({ lastSeen: now() }).where(eq(panelSessions.token, token)).run();
  return { ...user, sessionToken: token };
}

// Lists active sessions
export async function listSessions(username) {
  return await db.select().from(panelSessions).where(eq(panelSessions.username, username)).orderBy(db.desc ? db.desc(panelSessions.createdAt) : panelSessions.createdAt).all();
}

// delete session
export async function deleteSession(token) {
  await db.delete(panelSessions).where(eq(panelSessions.token, token)).run();
}

// update session name
export async function renameSession(token, name) {
  await db.update(panelSessions).set({ deviceName: name }).where(eq(panelSessions.token, token)).run();
}

// درخواست بازیابی رمز — ارسال یک کد یک‌بار مصرف به تلگرام
export async function requestPasswordReset(username) {
  username = (username || '').trim();
  const user = await db.select().from(panelUsers).where(eq(panelUsers.username, username)).get();
  if (!user) throw new EndpointError('یوزر پیدا نشد.', { code: 'USER_NOT_FOUND' });
  if (!user.telegramId) throw new EndpointError('برای این یوزر آیدی تلگرام ثبت نشده است.', { code: 'NO_TELEGRAM_ID' });

  const token = makeToken();
  const expiresAt = now() + 15 * 60 * 1000; // ۱۵ دقیقه
  await db.insert(panelResetTokens).values({ token, username, expiresAt, used: false }).run();

  const code = String(Math.floor(100000 + Math.random() * 900000));
  // ذخیره کد در همان توکن (ساده): در یک نسخه کامل، کد در جدول جداگانه ذخیره می‌شود
  // اینجا کد را در message می‌فرستیم و توکن فقط برای تایید درخواست است
  try {
    await api.sendMessage({
      chat_id: user.telegramId,
      text: `🔐 کد بازیابی رمز عبور برای یوزر «${username}»: ${code}\nاین کد تا ۱۵ دقیقه معتبر است.`,
    });
  } catch (e) {
    throw new EndpointError('ارسال پیام به تلگرام شکست خورد. آیا ربات را /start کرده‌اید؟', { code: 'TELEGRAM_SEND_FAILED' });
  }

  // کد را در entstandی ذخیره می‌کنیم (در یک نسخه واقعی باید در جدول riêng)
  // اینجا ساده: در reset_tokens.token همان کد را می‌گذاریم (نه تو تصادفی)
  await db.update(panelResetTokens).set({ token: code }).where(and(eq(panelResetTokens.username, username), eq(panelResetTokens.used, false))).run();

  return { message: 'کد بازیابی به تلگرام شما ارسال شد.' };
}

// تأیید کد بازیابی و تنظیم رمز جدید
export async function resetPassword(code, newPassword) {
  if (!newPassword || newPassword.length < 6) throw new EndpointError('رمز جدید باید حداقل ۶ کاراکتر باشد.', { code: 'BAD_PASSWORD' });
  const row = await db.select().from(panelResetTokens).where(eq(panelResetTokens.token, code)).get();
  if (!row) throw new EndpointError('کد بازیابی نامعتبر است.', { code: 'INVALID_RESET_CODE' });
  if (row.used) throw new EndpointError('این کد قبلاً استفاده شده است.', { code: 'RESET_CODE_USED' });
  if (now() > row.expiresAt) throw new EndpointError('کد بازیابی منقضی شده است.', { code: 'RESET_CODE_EXPIRED' });

  const user = await db.select().from(panelUsers).where(eq(panelUsers.username, row.username)).get();
  if (!user) throw new EndpointError('یوزر پیدا نشد.', { code: 'USER_NOT_FOUND' });

  const salt = makeSalt();
  const hash = await hashPassword(newPassword, salt);
  await db.update(panelUsers).set({ passwordHash: hash, salt }).where(eq(panelUsers.username, row.username)).run();
  await db.update(panelResetTokens).set({ used: true }).where(eq(panelResetTokens.token, code)).run();

  // دیگر نشست‌ها را بپاک (اجبار به ورود دوباره)
  await db.delete(panelSessions).where(eq(panelSessions.username, row.username)).run();

  const newToken = makeToken();
  await db.insert(panelSessions).values({
    token: newToken, username: row.username,
    deviceName: 'بازیابی رمز', platform: 'web',
    createdAt: now(), lastSeen: now(),
  }).run();

  return { token: newToken, role: user.role, is_owner: BOOTSTRAP_ADMINS.includes(user.telegramId) };
}

// تغییر رمز با رمز فعلی
export async function changePassword(username, currentPassword, newPassword) {
  if (!newPassword || newPassword.length < 6) throw new EndpointError('رمز جدید باید حداقل ۶ کاراکتر باشد.', { code: 'BAD_PASSWORD' });
  const user = await db.select().from(panelUsers).where(eq(panelUsers.username, username)).get();
  if (!user) throw new EndpointError('یوزر پیدا نشد.', { code: 'USER_NOT_FOUND' });

  const expected = await hashPassword(currentPassword, user.salt || '');
  if (expected !== user.passwordHash) throw new EndpointError('رمز فعلی اشتباه است.', { code: 'WRONG_PASSWORD' });

  const salt = makeSalt();
  const hash = await hashPassword(newPassword, salt);
  await db.update(panelUsers).set({ passwordHash: hash, salt }).where(eq(panelUsers.username, username)).run();
  await db.delete(panelSessions).where(eq(panelSessions.username, username)).run();

  const token = makeToken();
  await db.insert(panelSessions).values({ token, username, deviceName: 'تغییر رمز', platform: 'web', createdAt: now(), lastSeen: now() }).run();
  return { token };
}

// لیست کاربران (فقط ادمین)
export async function listPanelUsers() {
  const rows = await db.select().from(panelUsers).all();
  return rows.map((u) => ({
    username: u.username,
    role: u.role,
    suspended: !!u.suspended,
    telegramId: u.telegramId,
    hasBot: !!u.telegramId,
    createdAt: u.createdAt,
  }));
}

// ایجاد کاربر (فقط ادمین/بوت‌ استرپ)
export async function createPanelUser(username, password, telegramId, role) {
  if (!USERNAME_RE.test(username)) throw new EndpointError('یوزرنیم فقط حروف لاتین/عدد/آندرلاین، ۳ تا ۳۲ کاراکتر.', { code: 'BAD_USERNAME' });
  if (!password || password.length < 6) throw new EndpointError('رمز عبور باید حداقل ۶ کاراکتر باشد.', { code: 'BAD_PASSWORD' });
  const ex = await db.select().from(panelUsers).where(eq(panelUsers.username, username)).get();
  if (ex) throw new EndpointError('یوزرنیم قبلاً وجود دارد.', { code: 'USER_EXISTS' });

  const salt = makeSalt();
  const hash = await hashPassword(password, salt);
  await db.insert(panelUsers).values({
    username, passwordHash: hash, salt, telegramId: telegramId || null,
    role: role || 'user', suspended: false, createdAt: now(),
  }).run();
  return { message: `کاربر «${username}` + `» ساخته شد.` };
}

// تعليق/فعالسازی کاربر
export async function setSuspended(username, suspended) {
  const user = await db.select().from(panelUsers).where(eq(panelUsers.username, username)).get();
  if (!user) throw new EndpointError('یوزر پیدا نشد.', { code: 'USER_NOT_FOUND' });
  await db.update(panelUsers).set({ suspended: !!suspended }).where(eq(panelUsers.username, username)).run();
  if (suspended) await db.delete(panelSessions).where(eq(panelSessions.username, username)).run();
  return { message: suspended ? 'کاربر تعلیق شد.' : 'تعلیق برداشته شد.' };
}

// حذف کاربر
export async function deletePanelUser(username) {
  const user = await db.select().from(panelUsers).where(eq(panelUsers.username, username)).get();
  if (!user) throw new EndpointError('یوزر پیدا نشد.', { code: 'USER_NOT_FOUND' });
  await db.delete(panelUsers).where(eq(panelUsers.username, username)).run();
  await db.delete(panelSessions).where(eq(panelSessions.username, username)).run();
  await db.delete(panelResetTokens).where(eq(panelResetTokens.username, username)).run();
  return { message: 'کاربر حذف شد.' };
}

// اتصال آیدی تلگرام به کاربر
export async function setTelegramId(username, telegramId) {
  const user = await db.select().from(panelUsers).where(eq(panelUsers.username, username)).get();
  if (!user) throw new EndpointError('یوزر پیدا نشد.', { code: 'USER_NOT_FOUND' });
  await db.update(panelUsers).set({ telegramId: telegramId || null }).where(eq(panelUsers.username, username)).run();
  return { message: 'آیدی تلگرام ذخیره شد.' };
}

// تنظیم رمز جدید توسط ادمین (بدون نیاز به رمز فعلی)
export async function setPasswordByAdmin(username, newPassword) {
  if (!newPassword || newPassword.length < 6) throw new EndpointError('رمز جدید باید حداقل ۶ کاراکتر باشد.', { code: 'BAD_PASSWORD' });
  const user = await db.select().from(panelUsers).where(eq(panelUsers.username, username)).get();
  if (!user) throw new EndpointError('یوزر پیدا نشد.', { code: 'USER_NOT_FOUND' });
  const salt = makeSalt();
  const hash = await hashPassword(newPassword, salt);
  await db.update(panelUsers).set({ passwordHash: hash, salt }).where(eq(panelUsers.username, username)).run();
  await db.delete(panelSessions).where(eq(panelSessions.username, username)).run();
  return { message: 'رمز عبور توسط مدیریت تغییر کرد.' };
}

// تبدیل به ربات (simplified — در نسخه سرورلِس ربات ثابت است)
export async function setBotToken(username, token) {
  // در نسخه سرورلِس ربات یک است؛ اینجا فقط nitricём یک نشانه می‌گذاریم
  return { message: 'ربات در نسخه سرورلِس ثابت است.' };
}
