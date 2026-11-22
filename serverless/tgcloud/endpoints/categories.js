import { db, EndpointError } from 'sdk';
import { eq, asc } from 'sdk/db';
import { categories, chatCategories } from '../schema.js';
import { requireMember } from '../lib/auth.js';
import { assertCanSee } from '../lib/scope.js';
import { getChat } from '../lib/store.js';
import { now } from '../lib/util.js';

// دسته‌بندی چت‌ها. ساخت/ویرایش/حذف/ترتیب: فقط ادمین · قرار دادن چت در دسته‌ها (assign): همه‌ی اعضا
export default async function (input, ctx) {
  const op = input.op || 'list';
  const me = await requireMember(ctx, ['create', 'update', 'delete', 'reorder'].includes(op));
  const all = async () => (await db.select().from(categories).orderBy(asc(categories.sort), asc(categories.id)).all());

  if (op === 'create') {
    const name = String(input.name || '').trim().slice(0, 30);
    if (!name) throw new EndpointError('نام دسته خالی است.');
    const cur = await all();
    if (cur.length >= 30) throw new EndpointError('حداکثر ۳۰ دسته مجاز است.');
    if (cur.some((c) => c.name === name)) throw new EndpointError('دسته‌ای با این نام هست.');
    await db.insert(categories).values({ name, emoji: String(input.emoji || '').slice(0, 8), sort: cur.length ? Math.max(...cur.map((c) => c.sort)) + 1 : 0, createdAt: now() }).run();
  } else if (op === 'update') {
    const id = Number(input.id);
    const ex = (await all()).find((c) => c.id === id);
    if (!ex) throw new EndpointError('دسته پیدا نشد.');
    const patch = {};
    if ('name' in input) { const n = String(input.name || '').trim().slice(0, 30); if (!n) throw new EndpointError('نام دسته خالی است.'); patch.name = n; }
    if ('emoji' in input) patch.emoji = String(input.emoji || '').slice(0, 8);
    if (Object.keys(patch).length) await db.update(categories).set(patch).where(eq(categories.id, id)).run();
  } else if (op === 'delete') {
    const id = Number(input.id);
    await db.delete(chatCategories).where(eq(chatCategories.catId, id)).run();
    await db.delete(categories).where(eq(categories.id, id)).run();
  } else if (op === 'reorder') {
    const ids = Array.isArray(input.ids) ? input.ids.map(Number) : [];
    for (let i = 0; i < ids.length; i++) await db.update(categories).set({ sort: i }).where(eq(categories.id, ids[i])).run();
  } else if (op === 'assign') {
    const chatId = Number(input.chatId);
    const ch = await getChat(chatId);
    if (!ch) throw new EndpointError('چت پیدا نشد.');
    assertCanSee(me, ch);
    const valid = new Set((await all()).map((c) => c.id));
    const want = [...new Set((Array.isArray(input.categoryIds) ? input.categoryIds : []).map(Number))].filter((id) => valid.has(id));
    await db.delete(chatCategories).where(eq(chatCategories.chatId, chatId)).run();
    for (const catId of want) await db.insert(chatCategories).values({ key: `${chatId}:${catId}`, chatId, catId }).run();
    return { ok: true, categoryIds: want };
  } else if (op !== 'list') throw new EndpointError('عملیات نامعتبر.');

  return { categories: (await all()).map((c) => ({ id: c.id, name: c.name, emoji: c.emoji })) };
}
