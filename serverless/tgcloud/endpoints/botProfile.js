import { api, EndpointError } from 'sdk';
import { requireMember } from '../lib/auth.js';
import { faError } from '../lib/util.js';

// پروفایل ربات: مشاهده و تغییر نام / توضیح کوتاه / توضیح کامل (فقط ادمین).
// getMe نام/توضیحات را برنمی‌گرداند؛ هر کدام متد مخصوص خودش را دارند.
async function readProfile() {
  const [me, n, d, s] = await Promise.all([
    api.getMe(),
    api.getMyName({}).catch(() => null),
    api.getMyDescription({}).catch(() => null),
    api.getMyShortDescription({}).catch(() => null),
  ]);
  return {
    connected: true,
    id: me.id,
    username: me.username || '',
    name: (n && n.name) || me.first_name || '',
    short_description: (s && s.short_description) || '',
    description: (d && d.description) || '',
    can_join_groups: !!me.can_join_groups,
    can_read_all_group_messages: !!me.can_read_all_group_messages,
    supports_inline_queries: !!me.supports_inline_queries,
  };
}

export default async function (input, ctx) {
  await requireMember(ctx, true);
  const op = input.op || 'get';

  if (op === 'get') {
    try { return await readProfile(); }
    catch (e) { throw new EndpointError('اتصال به تلگرام برقرار نشد: ' + faError(e)); }
  }

  if (op === 'set') {
    const patch = {};
    if (input.name !== undefined) {
      const name = String(input.name || '').trim();
      if (!name) throw new EndpointError('نام ربات نمی‌تواند خالی باشد.');
      if (name.length > 64) throw new EndpointError('نام ربات حداکثر ۶۴ کاراکتر است.');
      patch.name = name;
    }
    if (input.short_description !== undefined) patch.short_description = String(input.short_description || '').slice(0, 120);
    if (input.description !== undefined) patch.description = String(input.description || '').slice(0, 512);

    if (!Object.keys(patch).length) throw new EndpointError('هیچ فیلدی برای تغییر ارسال نشد.', { code: 'EMPTY_PATCH' });

    const errors = [];
    // هر متد جدا صدا زده می‌شود تا یک خطا (مثلاً محدودیت تغییر نام) بقیه را از کار نیندازد.
    if (patch.name !== undefined) {
      try { await api.setMyName({ name: patch.name }); }
      catch (e) { errors.push('نام: ' + faError(e)); }
    }
    if (patch.short_description !== undefined) {
      try { await api.setMyShortDescription({ short_description: patch.short_description }); }
      catch (e) { errors.push('توضیح کوتاه: ' + faError(e)); }
    }
    if (patch.description !== undefined) {
      try { await api.setMyDescription({ description: patch.description }); }
      catch (e) { errors.push('توضیح کامل: ' + faError(e)); }
    }
    if (errors.length) throw new EndpointError(errors.join(' | '));

    try { return { ok: true, ...(await readProfile()) }; }
    catch (e) { return { ok: true }; }
  }

  throw new EndpointError('عملیات نامعتبر است.', { code: 'BAD_OP' });
}
