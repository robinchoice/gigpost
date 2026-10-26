import type { DealEvent, DealItem, Draft, FeedbackContext, Stage, UpdateContent } from '@app/shared';
import {
  bigint,
  boolean,
  customType,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  // Stored lowercase, see the email schema in @app/shared
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  // Opt-in for update mails, null = off. The time is the proof of consent.
  updatesConsentAt: timestamp('updates_consent_at'),
  // Language of the update mails, taken at login and when switching them on
  locale: varchar('locale', { length: 5 }).default('de').notNull(),
  // Key of the unsubscribe link in update mails, works without login
  unsubscribeToken: uuid('unsubscribe_token').defaultRandom().notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const magicLinks = pgTable('magic_links', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  // Ticked "send me updates", applied when the link is opened
  updatesOptIn: boolean('updates_opt_in').default(false).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Mobile apps log in with a code from the mail, a link can't open the app
export const loginCodes = pgTable('login_codes', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull(),
  codeHash: varchar('code_hash', { length: 64 }).notNull(),
  updatesOptIn: boolean('updates_opt_in').default(false).notNull(),
  attempts: integer('attempts').default(0).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Passkeys, added by a logged-in user (README, „Passkeys“). The id is the
// credential ID in base64url, the authenticator sends it with every login.
export const passkeys = pgTable('passkeys', {
  id: varchar('id', { length: 1400 }).primaryKey(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  publicKey: bytea('public_key').notNull(),
  counter: bigint('counter', { mode: 'number' }).notNull(),
  transports: jsonb('transports').$type<string[]>(),
  // Synced by a password manager, else bound to one device
  backedUp: boolean('backed_up').notNull(),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Challenges of running passkey ceremonies, single use. userId is set while
// adding a passkey, null for a login.
export const passkeyChallenges = pgTable('passkey_challenges', {
  challenge: varchar('challenge', { length: 100 }).primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
});

// Counters of lib/rate-limit.ts in the API
export const rateLimits = pgTable('rate_limits', {
  key: varchar('key', { length: 300 }).primaryKey(),
  count: integer('count').notNull(),
  resetAt: timestamp('reset_at').notNull(),
});

// Keys the API generates on first use, so every instance shares them and no
// deployment has to set them. `altcha` signs the challenges of lib/altcha.ts.
export const serverSecrets = pgTable('server_secrets', {
  name: varchar('name', { length: 50 }).primaryKey(),
  value: varchar('value', { length: 128 }).notNull(),
});

// Bug reports and ideas from the feedback button, also mailed and filed as
// GitHub issues. The random id is the key of the screenshot URL.
export const feedback = pgTable('feedback', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  kind: varchar('kind', { length: 10 }).notNull(),
  message: text('message').notNull(),
  screenshot: bytea('screenshot'),
  context: jsonb('context').$type<FeedbackContext & { api: string }>().notNull(),
  issueUrl: varchar('issue_url', { length: 300 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Update mails, see README „Update-Mails“. Drafts from updates/<slug>.md carry
// the slug, sentAt marks the moment Robin sent it.
export const updates = pgTable('updates', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: varchar('slug', { length: 200 }).unique(),
  content: jsonb('content').$type<UpdateContent>().notNull(),
  image: bytea('image'),
  sentAt: timestamp('sent_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// One row per recipient of a sent update, the worker works through the pending ones
export const updateDeliveries = pgTable(
  'update_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    updateId: uuid('update_id')
      .references(() => updates.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    // pending, sent, failed, or skipped when the user unsubscribed in between
    status: varchar('status', { length: 10 }).default('pending').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    // Last try, the send time once sent. Paces all workers together.
    attemptedAt: timestamp('attempted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [unique().on(table.updateId, table.userId)],
);

// Booking (AGENTS.md). One workspace for every account:
// sign-up is closed, Robin and the agents' test account share it.

// The artists Robin books, every deal belongs to one of them
export const artists = pgTable('artists', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 200 }).notNull().unique(),
  // Genre and line-up, e.g. "Indie-Rock, 4 Personen"
  kind: varchar('kind', { length: 300 }).default('').notNull(),
  // Link to the press kit the mails point to
  epk: varchar('epk', { length: 500 }).default('').notNull(),
  // Colour of the dot in lists and the edge of board cards
  color: varchar('color', { length: 7 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Clubs and festivals. Unique by email and by name plus city, so agents
// don't add a venue twice (see venueKey in @app/shared).
export const venues = pgTable('venues', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  city: varchar('city', { length: 200 }).notNull(),
  // Normalised "name|city"
  key: varchar('key', { length: 401 }).notNull().unique(),
  capacity: integer('capacity'),
  genre: varchar('genre', { length: 300 }).default('').notNull(),
  contact: varchar('contact', { length: 200 }).default('').notNull(),
  // Stored lowercase
  email: varchar('email', { length: 255 }).unique(),
  website: varchar('website', { length: 500 }).default('').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// One artist at one venue: the card on the board
export const deals = pgTable(
  'deals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    venueId: uuid('venue_id')
      .references(() => venues.id, { onDelete: 'cascade' })
      .notNull(),
    artistId: uuid('artist_id')
      .references(() => artists.id, { onDelete: 'cascade' })
      .notNull(),
    // See STAGES
    stage: varchar('stage', { length: 10 }).$type<Stage>().default('draft').notNull(),
    // Why the agent suggests this venue for this artist
    why: text('why').default('').notNull(),
    gigDate: varchar('gig_date', { length: 10 }),
    fee: varchar('fee', { length: 200 }).default('').notNull(),
    // A reply came in and Robin hasn't dealt with it yet
    replyOpen: boolean('reply_open').default(false).notNull(),
    lastSentAt: timestamp('last_sent_at'),
    lastReplyAt: timestamp('last_reply_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [unique().on(table.venueId, table.artistId)],
);

// The mail waiting for Robin, at most one per deal. Sending or discarding deletes it.
export const drafts = pgTable('drafts', {
  id: uuid('id').defaultRandom().primaryKey(),
  dealId: uuid('deal_id')
    .references(() => deals.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  kind: varchar('kind', { length: 10 }).$type<Draft['kind']>().notNull(),
  to: varchar('to', { length: 500 }).notNull(),
  subject: varchar('subject', { length: 300 }).notNull(),
  body: text('body').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Notes, deadlines and documents (links for now) of a deal
export const dealItems = pgTable('deal_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  dealId: uuid('deal_id')
    .references(() => deals.id, { onDelete: 'cascade' })
    .notNull(),
  kind: varchar('kind', { length: 10 }).$type<DealItem['kind']>().notNull(),
  text: varchar('text', { length: 1000 }).notNull(),
  due: varchar('due', { length: 10 }),
  url: varchar('url', { length: 1000 }),
  doneAt: timestamp('done_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// The history of a deal. kind request or followup: a mail went out, text is
// its subject. reply: Robin marked a reply, text his summary. stage: text is
// the new stage. The web shows them in the reader's language.
export const dealEvents = pgTable('deal_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  dealId: uuid('deal_id')
    .references(() => deals.id, { onDelete: 'cascade' })
    .notNull(),
  kind: varchar('kind', { length: 10 }).$type<DealEvent['kind']>().notNull(),
  text: varchar('text', { length: 1000 }).default('').notNull(),
  // Message-ID of a sent mail, a follow-up answers in the same thread
  messageId: varchar('message_id', { length: 300 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
