import { db } from 'sdk';
import { and, eq, isNull } from 'sdk/db';
import { chats } from '../schema.js';
import { saveConnection, memberRole } from '../lib/store.js';
import { maybeAskKey } from '../lib/aiOnboarding.js';

// اتصال بیزینس وصل/قطع شد. صاحب چت‌های این اتصال همان صاحب اکانت بیزینس است.
export default async function (c) {
  if (!c || !c.id || !c.user) return;
  await saveConnection(c.id, c.user.id, c.is_enabled !== false);
  const name = [c.user.first_name, c.user.last_name].filter(Boolean).join(' ');
  await db.update(chats).set({ ownerId: c.user.id, ownerName: name })
    .where(and(eq(chats.bizId, c.id), isNull(chats.ownerId))).run();

  // اگر صاحب اکانت عضو پنل است و هنوز کلید AI خودش را ندارد، همان لحظه ازش بخواه.
  if (c.is_enabled !== false) {
    try {
      if (await memberRole(c.user.id)) await maybeAskKey(c.user.id);
    } catch (e) { /* ربات بلاک شده یا شبکه قطع است */ }
  }
}
