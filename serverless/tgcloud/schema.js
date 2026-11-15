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

// تنظیمات کلی (key → value)
export const settings = table('settings', {
  key:   text('key').primaryKey(),
  value: json('value'),
});

// اتصال‌های Telegram Business: هر اتصال متعلق به یک اکانت (user_id)
export const connections = table('connections', {
  id:      text('id').primaryKey(),
  userId:  integer('user_id'),
  enabled: boolean('enabled').notNull().default(true),
  ts:      integer('ts'),
});

export const chats = table('chats', {
  id:             integer('id').primaryKey(),
  title:          text('title').notNull().default(''),
  kind:           text('kind').default('private'),
  isGroup:        boolean('is_group').notNull().default(false),
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
});

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
