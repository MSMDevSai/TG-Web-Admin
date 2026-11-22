// پایگاه‌داده‌ی پنل. توجه: foreign key در Telegram Serverless ممنوعه، پس رابطه‌ها فقط ستون ساده‌اند.
import { table, integer, text, boolean, json, blob, index } from 'sdk/db';

// کسانی که اجازه‌ی ورود به پنل دارند (آیدی عددی تلگرام) + نقش: admin | user
export const members = table('members', {
  tgId:      integer('tg_id').primaryKey(),
  role:      text('role').notNull().default('user'),
  name:      text('name').default(''),
  notify:    boolean('notify').notNull().default(true),
  addedBy:   integer('added_by'),
  createdAt: integer('created_at'),
});

// تنظیمات کلی (key → value) — پیش‌فرض‌هایی که ادمین برای همه تعیین می‌کند
export const settings = table('settings', {
  key:   text('key').primaryKey(),
  value: json('value'),
});

// تنظیمات اختصاصی هر عضو (override روی پیش‌فرض‌های بالا).
// ستون NULL یعنی «از پیش‌فرض ادمین استفاده کن»؛ برای همین هر عضو فقط چیزهایی
// را ذخیره می‌کند که خودش تغییر داده است.
export const memberSettings = table('member_settings', {
  tgId:           integer('tg_id').primaryKey(),
  geminiApiKey:   text('gemini_api_key').default(''),   // کلید اختصاصی Google AI Studio
  geminiModel:    text('gemini_model'),                 // مدل دلخواه (null = پیش‌فرض)
  systemPrompt:   text('system_prompt'),                // پرامپت اختصاصی (null = پیش‌فرض)
  assistantLabel: text('assistant_label'),              // برچسب دستیار (null = پیش‌فرض)
  aiMode:         text('ai_mode'),                      // 'on' | 'off' | null = پیش‌فرض
  onboardedAt:    integer('onboarded_at'),              // اولین بار که ربات کلید را درخواست کرد
  updatedAt:      integer('updated_at'),
});

// اتصال‌های Telegram Business: هر اتصال متعلق به یک اکانت (user_id)
export const connections = table('connections', {
  id:      text('id').primaryKey(),
  userId:  integer('user_id'),
  enabled: boolean('enabled').notNull().default(true),
  ts:      integer('ts'),
});

// ownerId = صاحب چت (آیدی عددی تلگرام). هر عضو فقط چت‌های خودش را می‌بیند؛
// ادمین‌ها همه را می‌بینند. برای چت خصوصیِ ربات خودِ طرف، برای بیزینس صاحب
// اتصال و برای گروه کسی که ربات را اضافه کرده است.
export const chats = table('chats', {
  id:             integer('id').primaryKey(),
  title:          text('title').notNull().default(''),
  kind:           text('kind').default('private'),
  isGroup:        boolean('is_group').notNull().default(false),
  ownerId:        integer('owner_id'),
  ownerName:      text('owner_name').default(''),
  bizId:          text('biz_id'),
  hasBotChat:     boolean('has_bot_chat').notNull().default(false),
  muted:          boolean('muted').notNull().default(false),
  pinned:         boolean('pinned').notNull().default(false),
  aiMode:         text('ai_mode'),                      // null = طبق تنظیم کلی | 'on' | 'off'
  prompt:         text('prompt').notNull().default(''),
  lastText:       text('last_text').notNull().default(''),
  lastSender:     text('last_sender').notNull().default(''),
  lastTs:         integer('last_ts').notNull().default(0),
  aiPendingUntil: integer('ai_pending_until').notNull().default(0),
  createdAt:      integer('created_at'),
}, (t) => ({ byOwner: index('idx_chats_owner').on(t.ownerId, t.lastTs) }));

// همه‌ی پیام‌ها. هیچ‌وقت حذف نمی‌شن؛ حذف فقط deleted_at می‌زنه (حالت «کالکتور»).
export const messages = table('messages', {
  id:            integer('id').primaryKey({ autoIncrement: true }),
  chatId:        integer('chat_id').notNull(),
  msgId:         integer('msg_id'),
  role:          text('role').notNull(),                // user | owner | admin | model | bot_auto
  sender:        text('sender').default(''),
  senderId:      integer('sender_id'),
  text:          text('text').notNull().default(''),
  type:          text('type'),
  fileId:        text('file_id'),
  mediaKey:      text('media_key'),
  replyToMsgId:  integer('reply_to_msg_id'),
  replyPreview:  text('reply_preview'),
  forwardedFrom: text('forwarded_from'),
  myReaction:    text('my_reaction'),
  theirReaction: text('their_reaction'),
  senderMode:    text('sender_mode'),
  byMember:      integer('by_member'),
  ts:            integer('ts').notNull(),
  editedAt:      integer('edited_at'),
  deletedAt:     integer('deleted_at'),
  deletedBy:     text('deleted_by'),
  pinnedAt:      integer('pinned_at'),                  // سنجاق‌شده داخل چت (زمان سنجاق)
}, (t) => ({
  byChat: index('idx_messages_chat').on(t.chatId, t.id),
  byTg:   index('idx_messages_tg').on(t.chatId, t.msgId),
}));

// تاریخچه‌ی ویرایش‌ها: متن قبلی هر پیام
export const edits = table('edits', {
  id:      integer('id').primaryKey({ autoIncrement: true }),
  chatId:  integer('chat_id').notNull(),
  msgId:   integer('msg_id').notNull(),
  oldText: text('old_text').notNull().default(''),
  ts:      integer('ts').notNull(),
}, (t) => ({ byMsg: index('idx_edits_msg').on(t.chatId, t.msgId) }));

// آرشیو بایت‌های رسانه (کلید = file_unique_id). saved=false یعنی فقط file_id داریم.
export const media = table('media', {
  key:    text('key').primaryKey(),
  fileId: text('file_id').notNull(),
  kind:   text('kind'),
  mime:   text('mime'),
  size:   integer('size').default(0),
  data:   blob('data'),
  saved:  boolean('saved').notNull().default(false),
  ts:     integer('ts'),
});

// تکه‌های موقت آپلود از Mini App (base64)
export const uploadParts = table('upload_parts', {
  key:      text('key').primaryKey(),
  uploadId: text('upload_id').notNull(),
  part:     integer('part').notNull(),
  data:     text('data').notNull(),
  ts:       integer('ts'),
}, (t) => ({ byUpload: index('idx_upload_parts_upload').on(t.uploadId) }));

// آخرین پیام خوانده‌شده‌ی هر عضو در هر چت
export const reads = table('reads', {
  key:    text('key').primaryKey(),
  tgId:   integer('tg_id').notNull(),
  chatId: integer('chat_id').notNull(),
  lastId: integer('last_id').notNull().default(0),
});

// ─── دسته‌بندی چت‌ها (مشترک بین همه‌ی اعضا؛ ساخت/ویرایش با ادمین، انتساب با همه) ───
export const categories = table('categories', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  name:      text('name').notNull(),
  emoji:     text('emoji').notNull().default(''),
  sort:      integer('sort').notNull().default(0),
  createdAt: integer('created_at'),
});

export const chatCategories = table('chat_categories', {
  key:    text('key').primaryKey(),                    // <chatId>:<catId>
  chatId: integer('chat_id').notNull(),
  catId:  integer('cat_id').notNull(),
}, (t) => ({
  byChat: index('idx_chat_categories_chat').on(t.chatId),
  byCat:  index('idx_chat_categories_cat').on(t.catId),
}));

// ─── گزارش اقدام‌های مدیریت گروه ───
export const modLog = table('mod_log', {
  id:         integer('id').primaryKey({ autoIncrement: true }),
  chatId:     integer('chat_id').notNull(),
  targetId:   integer('target_id'),
  targetName: text('target_name').default(''),
  action:     text('action').notNull(),                // ban | unban | mute | unmute | kick | delete_user | delete_bulk
  untilTs:    integer('until_ts'),
  count:      integer('count'),
  byId:       integer('by_id'),
  byName:     text('by_name').default(''),
  ts:         integer('ts').notNull(),
}, (t) => ({ byChat: index('idx_mod_log_chat').on(t.chatId, t.id) }));

// ─── پیام ناشناس ───
// لینک خصوصی هر نفر (مالک). مالک = آیدی عددی تلگرامِ کسی که /anon زده؛ لزوماً عضو پنل نیست.
export const anonLinks = table('anon_links', {
  token:     text('token').primaryKey(),
  ownerId:   integer('owner_id').notNull(),
  ownerName: text('owner_name').default(''),
  enabled:   boolean('enabled').notNull().default(true),
  uses:      integer('uses').notNull().default(0),
  createdAt: integer('created_at'),
}, (t) => ({ byOwner: index('idx_anon_links_owner').on(t.ownerId) }));

// هر فرستنده در هر لحظه فقط به یک لینک وصله (تا /stop یا لینک دیگر)
export const anonSessions = table('anon_sessions', {
  senderId: integer('sender_id').primaryKey(),
  token:    text('token').notNull(),
  ts:       integer('ts').notNull(),
});

// فقط برای مسیریابی پاسخ و محدودیت نرخ؛ متن پیام اینجا ذخیره نمی‌شود. پس از anon_retention_days پاک می‌شود.
export const anonMessages = table('anon_messages', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  ref:         text('ref').notNull(),                  // شناسه‌ی کوتاه برای دکمه‌های زیر پیام
  dir:         text('dir').notNull(),                  // in (فرستنده→مالک) | out (مالک→فرستنده)
  ownerId:     integer('owner_id').notNull(),
  senderId:    integer('sender_id').notNull(),
  ownerMsgId:  integer('owner_msg_id'),                // آیدی پیام در چت مالک با ربات
  text:        text('text').default(''),               // متن پیام (فقط برای نمایش گزارش به ادمین)
  kind:        text('kind').default(''),               // text | photo | video | voice | file | sticker | ...
  ts:          integer('ts').notNull(),
}, (t) => ({
  byRef:   index('idx_anon_messages_ref').on(t.ref),
  byOwner: index('idx_anon_messages_owner').on(t.ownerId, t.ownerMsgId),
  bySender: index('idx_anon_messages_sender').on(t.senderId, t.ts),
}));

// شماره‌ی ثابت «ناشناس #N» برای هر فرستنده نزد هر مالک
export const anonAliases = table('anon_aliases', {
  key:      text('key').primaryKey(),                  // <ownerId>:<senderId>
  ownerId:  integer('owner_id').notNull(),
  senderId: integer('sender_id').notNull(),
  n:        integer('n').notNull(),
  ts:       integer('ts'),
}, (t) => ({ byOwner: index('idx_anon_aliases_owner').on(t.ownerId) }));

// بلاک: ownerId=0 یعنی بلاک سراسری (توسط ادمین ربات)
export const anonBlocks = table('anon_blocks', {
  key:      text('key').primaryKey(),                  // <ownerId>:<senderId>
  ownerId:  integer('owner_id').notNull(),
  senderId: integer('sender_id').notNull(),
  by:       text('by').default(''),
  ts:       integer('ts'),
});

// گزارش‌های پیام ناشناس. دلیل گزارش را مالک لینک می‌نویسد و ادمین کل گفتگو را می‌بیند.
export const anonReports = table('anon_reports', {
  id:         integer('id').primaryKey({ autoIncrement: true }),
  ref:        text('ref').default(''),                 // ref پیام گزارش‌شده
  ownerId:    integer('owner_id').notNull(),
  senderId:   integer('sender_id').notNull(),
  reason:     text('reason').default(''),
  status:     text('status').notNull().default('open'), // open | resolved
  by:         integer('by'),                            // ادمینی که رسیدگی کرد
  ts:         integer('ts').notNull(),
  resolvedAt: integer('resolved_at'),
}, (t) => ({ byStatus: index('idx_anon_reports_status').on(t.status, t.ts) }));

// ─── مدیریت کاربران ربات ───
// هر کسی که به بات پیام خصوصی داده (برای انتخاب مخاطب در پنل و مدیریت)
export const botUsers = table('bot_users', {
  tgId:      integer('tg_id').primaryKey(),
  name:      text('name').default(''),
  username:  text('username').default(''),
  lastText:  text('last_text').default(''),
  firstSeen: integer('first_seen'),
  lastSeen:  integer('last_seen'),
}, (t) => ({ byLast: index('idx_bot_users_last').on(t.lastSeen) }));

// بلاک سراسری کاربر در ربات. permanent=1 یعنی راه تماسی هم ندارد.
export const userBlocks = table('user_blocks', {
  tgId:      integer('tg_id').primaryKey(),
  reason:    text('reason').default(''),
  permanent: boolean('permanent').notNull().default(false),
  by:        text('by').default(''),
  ts:        integer('ts'),
});

// اخطارهای دستی/خودکار به کاربر (با دلیل)
export const warnings = table('warnings', {
  id:     integer('id').primaryKey({ autoIncrement: true }),
  tgId:   integer('tg_id').notNull(),
  reason: text('reason').notNull(),
  byId:   integer('by_id'),
  byName: text('by_name').default(''),
  ts:     integer('ts').notNull(),
}, (t) => ({ byUser: index('idx_warnings_user').on(t.tgId, t.ts) }));

// درخواست تماس/اعتراض کاربر (دستور /contact) — ادمین در پنل می‌بیند.
export const contactRequests = table('contact_requests', {
  id:      integer('id').primaryKey({ autoIncrement: true }),
  tgId:    integer('tg_id').notNull(),
  name:    text('name').default(''),
  text:    text('text').notNull(),
  kind:    text('kind').default('contact'),            // contact | appeal
  handled: boolean('handled').notNull().default(false),
  ts:      integer('ts').notNull(),
}, (t) => ({ byTs: index('idx_contact_requests_ts').on(t.ts) }));

// وضعیت موقت گفتگو با ربات (منتظر دلیل گزارش، دلیل بلاک، متن اخطار و…)
export const uiState = table('ui_state', {
  tgId:  integer('tg_id').primaryKey(),
  key:   text('key').notNull(),
  value: text('value').default(''),
  ts:    integer('ts'),
});

// شمارنده‌های آماری (AI، خطا، پیام و…)
export const counters = table('counters', {
  key:   text('key').primaryKey(),
  value: integer('value').notNull().default(0),
  ts:    integer('ts'),
});

// ─── کاربر پنل (ورazos با یوزرنیم/پسورد خارج از تلگرام) ───
export const panelUsers = table('panel_users', {
  username:   text('username').primaryKey(),
  passwordHash: text('password_hash').notNull(),
  salt:       text('salt').notNull(),
  telegramId: integer('telegram_id'),
  role:       text('role').notNull().default('user'),   // admin | user
  suspended:  boolean('suspended').notNull().default(false),
  createdAt:  integer('created_at'),
}, (t) => ({ byTg: index('idx_panel_users_tg').on(t.telegramId) }));

// نشست‌های وارد شده (هر دستگاه یک توکن)
export const panelSessions = table('panel_sessions', {
  token:      text('token').primaryKey(),
  username:   text('username').notNull(),
  deviceName: text('device_name').default(''),
  platform:   text('platform').default('web'),
  createdAt:  integer('created_at'),
  lastSeen:   integer('last_seen'),
}, (t) => ({ byUser: index('idx_panel_sessions_user').on(t.username) }));

// توکن بازیابی یک‌بار مصرف رمز عبور
export const panelResetTokens = table('panel_reset_tokens', {
  token:      text('token').primaryKey(),
  username:   text('username').notNull(),
  expiresAt:  integer('expires_at').notNull(),
  used:       boolean('used').notNull().default(false),
});
