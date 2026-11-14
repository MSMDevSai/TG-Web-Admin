import { db } from 'sdk';
import { members } from '../schema.js';
import { requireMember } from '../lib/auth.js';

// تنظیمات شخصی هر عضو: اعلان‌های تلگرامی روشن/خاموش
export default async function (input, ctx) {
  const me = await requireMember(ctx);
  const notify = !!input.notify;
  await db.insert(members).values({ tgId: me.id, role: me.role, name: me.name, notify })
    .onConflictDoUpdate({ target: members.tgId, set: { notify } }).run();
  return { notify };
}
