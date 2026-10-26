import { artists, dealEvents, dealItems, deals, drafts, venues } from '@app/db';
import {
  artistSchema,
  type Booking,
  type Deal,
  dealUpdateSchema,
  draftSchema,
  GLOW,
  itemSchema,
  itemUpdateSchema,
  replySchema,
  sendSchema,
  type Venue,
  venueKey,
  venueSchema,
} from '@app/shared';
import { and, asc, desc, eq, or } from 'drizzle-orm';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { bookingSender, sendBookingMail } from '../lib/booking-mail';
import { t } from '../lib/i18n';
import { UUID } from '../lib/image';
import { rateLimit, tooManyRequests } from '../lib/rate-limit';
import { validJson } from '../lib/validate';
import { requireAdmin, requireAuth } from '../middleware/auth';
import type { AppEnv } from '../types';

// Generous for a stack of drafts, tight enough that a loop can't spam venues
const mailsPerUser = rateLimit('booking-mail-per-user', 100, 60 * 60 * 1000);

// Artist dots take the glow tones in this order, so the first two differ clearly
const COLORS = [4, 6, 1, 3, 5, 2, 0].map((i) => GLOW[i]!);

const notFound = (c: Context) => c.json({ error: t(c).notFound }, 404);
const validId = (c: Context, name = 'id') => {
  const id = c.req.param(name);
  return id && UUID.test(id) ? id : null;
};

const recipient = (venue: { contact: string; email: string | null }) =>
  venue.email ? (venue.contact ? `${venue.contact} <${venue.email}>` : venue.email) : '';

const iso = (date: Date | null) => date?.toISOString() ?? null;

type VenueRow = typeof venues.$inferSelect;
const toVenue = ({ id, name, city, capacity, genre, contact, email, website }: VenueRow): Venue => ({
  id,
  name,
  city,
  capacity,
  genre,
  contact,
  email,
  website,
});

// Everything at once: a booking desk holds hundreds of deals, not millions.
// Web and CLI derive today's view, the stack of drafts and the board from it.
async function loadBooking(c: Context<AppEnv>): Promise<Booking> {
  const db = c.get('db');
  const [artistRows, dealRows, draftRows, itemRows, eventRows] = await Promise.all([
    db.select().from(artists).orderBy(asc(artists.createdAt)),
    db.select().from(deals).innerJoin(venues, eq(venues.id, deals.venueId)).orderBy(desc(deals.updatedAt)),
    db.select().from(drafts).orderBy(asc(drafts.createdAt)),
    db.select().from(dealItems).orderBy(asc(dealItems.due), asc(dealItems.createdAt)),
    db.select().from(dealEvents).orderBy(asc(dealEvents.createdAt)),
  ]);
  const byDeal = <T extends { dealId: string }>(rows: T[]) => Map.groupBy(rows, (row) => row.dealId);
  const draftsByDeal = new Map(draftRows.map((row) => [row.dealId, row]));
  const items = byDeal(itemRows);
  const events = byDeal(eventRows);

  const result: Deal[] = dealRows.map(({ deals: deal, venues: venue }) => {
    const draft = draftsByDeal.get(deal.id);
    return {
      id: deal.id,
      venue: toVenue(venue),
      artistId: deal.artistId,
      stage: deal.stage,
      why: deal.why,
      gigDate: deal.gigDate,
      fee: deal.fee,
      replyOpen: deal.replyOpen,
      lastSentAt: iso(deal.lastSentAt),
      lastReplyAt: iso(deal.lastReplyAt),
      draft: draft
        ? {
            id: draft.id,
            kind: draft.kind,
            to: draft.to,
            subject: draft.subject,
            body: draft.body,
            createdAt: draft.createdAt.toISOString(),
          }
        : null,
      items: (items.get(deal.id) ?? []).map((item) => ({
        id: item.id,
        kind: item.kind,
        text: item.text,
        due: item.due,
        url: item.url,
        done: item.doneAt !== null,
      })),
      events: (events.get(deal.id) ?? []).map((event) => ({
        id: event.id,
        kind: event.kind,
        text: event.text,
        at: event.createdAt.toISOString(),
      })),
    };
  });
  return {
    artists: artistRows.map(({ id, name, kind, epk, color }) => ({ id, name, kind, epk, color })),
    deals: result,
    canSend: c.get('user').admin,
    from: bookingSender(),
  };
}

async function findDeal(c: Context<AppEnv>, id: string) {
  const [row] = await c
    .get('db')
    .select()
    .from(deals)
    .innerJoin(venues, eq(venues.id, deals.venueId))
    .innerJoin(artists, eq(artists.id, deals.artistId))
    .where(eq(deals.id, id));
  return row;
}

const touch = { updatedAt: new Date() };

// Under /api/v1/booking, every route needs a login
export const bookingRoutes = new Hono<AppEnv>()
  .use(requireAuth)

  .get('/', async (c) => c.json(await loadBooking(c)))

  .post('/artists', validJson(artistSchema), async (c) => {
    const db = c.get('db');
    const { name, kind = '', epk = '' } = c.req.valid('json');
    const count = await db.$count(artists);
    const [artist] = await db
      .insert(artists)
      .values({ name, kind, epk, color: COLORS[count % COLORS.length]! })
      .onConflictDoNothing()
      .returning();
    if (!artist) return c.json({ error: t(c).artistExists(name) }, 409);
    return c.json({ artist: { id: artist.id, name, kind, epk, color: artist.color } });
  })

  // Removes an artist with all their deals, such as test data. Admins only,
  // the history goes with it.
  .delete('/artists/:id', requireAdmin, async (c) => {
    const id = validId(c);
    if (!id) return notFound(c);
    const [artist] = await c.get('db').delete(artists).where(eq(artists.id, id)).returning({ id: artists.id });
    return artist ? c.json({ ok: true }) : notFound(c);
  })

  // Agents add what they found. A venue with the same email or the same name
  // and city exists only once, the answer names it.
  .post('/venues', validJson(venueSchema), async (c) => {
    const db = c.get('db');
    const input = c.req.valid('json');
    const key = venueKey(input.name, input.city);
    const [venue] = await db
      .insert(venues)
      .values({ ...input, key, email: input.email ?? null, capacity: input.capacity ?? null })
      .onConflictDoNothing()
      .returning();
    if (venue) return c.json({ venue: toVenue(venue) });
    const [existing] = await db
      .select()
      .from(venues)
      .where(or(eq(venues.key, key), input.email ? eq(venues.email, input.email) : undefined));
    return c.json(
      { error: t(c).venueExists(existing?.name ?? input.name, existing?.city ?? input.city, existing?.id ?? '') },
      409,
    );
  })

  .patch('/venues/:id', validJson(venueSchema.partial()), async (c) => {
    const id = validId(c);
    if (!id) return notFound(c);
    const db = c.get('db');
    const [current] = await db.select().from(venues).where(eq(venues.id, id));
    if (!current) return notFound(c);
    const input = c.req.valid('json');
    const name = input.name ?? current.name;
    const city = input.city ?? current.city;
    const [venue] = await db
      .update(venues)
      .set({ ...input, key: venueKey(name, city) })
      .where(eq(venues.id, id))
      .returning()
      .catch(() => []);
    if (!venue) return c.json({ error: t(c).venueExists(name, city, '') }, 409);
    return c.json({ venue: toVenue(venue) });
  })

  // A request for one artist at one venue, waiting for Robin under Drafts
  .post('/drafts', validJson(draftSchema), async (c) => {
    const db = c.get('db');
    const { venueId, artistId, why = '', to, subject, body } = c.req.valid('json');
    const [venue] = await db.select().from(venues).where(eq(venues.id, venueId));
    const [artist] = await db.select().from(artists).where(eq(artists.id, artistId));
    if (!venue || !artist) return notFound(c);
    const address = to || recipient(venue);
    if (!address) return c.json({ error: t(c).noEmail(venue.name) }, 400);

    const created = await db.transaction(async (tx) => {
      const [deal] = await tx.insert(deals).values({ venueId, artistId, why }).onConflictDoNothing().returning();
      if (!deal) return null;
      const [draft] = await tx
        .insert(drafts)
        .values({ dealId: deal.id, kind: 'request', to: address, subject, body, createdBy: c.get('user').id })
        .returning();
      return { dealId: deal.id, draftId: draft!.id };
    });
    if (!created) return c.json({ error: t(c).dealExists(venue.name, artist.name) }, 409);
    return c.json(created);
  })

  // Only admins: the mail goes out in Robin's name to a third party. Agents
  // log in with the test account, which is never an admin.
  .post('/drafts/:id/send', requireAdmin, validJson(sendSchema), async (c) => {
    const id = validId(c);
    if (!id) return notFound(c);
    const user = c.get('user');
    if (!bookingSender()) return c.json({ error: t(c).sendingOff }, 503);
    if (!(await mailsPerUser.hit(c, user.id))) return tooManyRequests(c);
    const { to, subject, body } = c.req.valid('json');

    // The lock makes a double click send once, the second finds no draft
    const sent = await c.get('db').transaction(async (tx) => {
      const [draft] = await tx.select().from(drafts).where(eq(drafts.id, id)).for('update');
      if (!draft) return false;
      const [deal] = await tx.select().from(deals).where(eq(deals.id, draft.dealId));
      const [previous] = await tx
        .select({ messageId: dealEvents.messageId })
        .from(dealEvents)
        .where(and(eq(dealEvents.dealId, draft.dealId), eq(dealEvents.kind, 'request')))
        .orderBy(desc(dealEvents.createdAt))
        .limit(1);
      const messageId = await sendBookingMail({
        to,
        subject,
        text: body,
        inReplyTo: draft.kind === 'followup' ? (previous?.messageId ?? null) : null,
      });
      await tx.delete(drafts).where(eq(drafts.id, id));
      await tx.insert(dealEvents).values({ dealId: draft.dealId, kind: draft.kind, text: subject, messageId });
      await tx
        .update(deals)
        .set({ stage: deal!.stage === 'draft' ? 'asked' : deal!.stage, lastSentAt: new Date(), ...touch })
        .where(eq(deals.id, draft.dealId));
      return true;
    });
    if (!sent) return notFound(c);
    return c.json({ ok: true });
  })

  // Discarding a request archives the deal, so agents don't suggest the venue again
  .delete('/drafts/:id', async (c) => {
    const id = validId(c);
    if (!id) return notFound(c);
    const db = c.get('db');
    const [draft] = await db.delete(drafts).where(eq(drafts.id, id)).returning();
    if (!draft) return notFound(c);
    const [deal] = await db.select().from(deals).where(eq(deals.id, draft.dealId));
    if (deal?.stage === 'draft') {
      await db
        .update(deals)
        .set({ stage: 'archived', ...touch })
        .where(eq(deals.id, deal.id));
      await db.insert(dealEvents).values({ dealId: deal.id, kind: 'stage', text: 'archived' });
    }
    return c.json({ ok: true });
  })

  .patch('/deals/:id', validJson(dealUpdateSchema), async (c) => {
    const id = validId(c);
    if (!id) return notFound(c);
    const db = c.get('db');
    const input = c.req.valid('json');
    const [before] = await db.select().from(deals).where(eq(deals.id, id));
    if (!before) return notFound(c);
    await db
      .update(deals)
      .set({ ...input, ...touch })
      .where(eq(deals.id, id));
    if (input.stage && input.stage !== before.stage) {
      await db.insert(dealEvents).values({ dealId: id, kind: 'stage', text: input.stage });
    }
    return c.json({ ok: true });
  })

  // Robin marks a reply he got in his mailbox. Reading it in automatically
  // through the Proton Bridge comes later.
  .post('/deals/:id/reply', validJson(replySchema), async (c) => {
    const id = validId(c);
    if (!id) return notFound(c);
    const db = c.get('db');
    const [deal] = await db.select().from(deals).where(eq(deals.id, id));
    if (!deal) return notFound(c);
    await db.insert(dealEvents).values({ dealId: id, kind: 'reply', text: c.req.valid('json').text ?? '' });
    await db
      .update(deals)
      .set({
        replyOpen: true,
        lastReplyAt: new Date(),
        stage: deal.stage === 'draft' || deal.stage === 'asked' ? 'talking' : deal.stage,
        ...touch,
      })
      .where(eq(deals.id, id));
    return c.json({ ok: true });
  })

  // A follow-up in the same thread, from the template in the reader's language
  .post('/deals/:id/followup', async (c) => {
    const id = validId(c);
    if (!id) return notFound(c);
    const row = await findDeal(c, id);
    if (!row) return notFound(c);
    const { deals: deal, venues: venue, artists: artist } = row;
    const db = c.get('db');
    const [request] = await db
      .select()
      .from(dealEvents)
      .where(and(eq(dealEvents.dealId, id), eq(dealEvents.kind, 'request')))
      .orderBy(desc(dealEvents.createdAt))
      .limit(1);
    const address = recipient(venue);
    if (!address) return c.json({ error: t(c).noEmail(venue.name) }, 400);
    const m = t(c);
    const [draft] = await db
      .insert(drafts)
      .values({
        dealId: deal.id,
        kind: 'followup',
        to: address,
        subject: m.followUpSubject(request?.text ?? `${artist.name} – ${venue.name}`),
        body: m.followUpBody(venue.contact.split(' ')[0] ?? '', artist.name, request?.createdAt ?? null),
        createdBy: c.get('user').id,
      })
      .onConflictDoNothing()
      .returning();
    if (!draft) return c.json({ error: t(c).draftOpen }, 409);
    return c.json({ draftId: draft.id });
  })

  .post('/deals/:id/items', validJson(itemSchema), async (c) => {
    const id = validId(c);
    if (!id) return notFound(c);
    const db = c.get('db');
    const [deal] = await db.select({ id: deals.id }).from(deals).where(eq(deals.id, id));
    if (!deal) return notFound(c);
    const [item] = await db
      .insert(dealItems)
      .values({ dealId: id, ...c.req.valid('json') })
      .returning({ id: dealItems.id });
    await db.update(deals).set(touch).where(eq(deals.id, id));
    return c.json({ itemId: item!.id });
  })

  .patch('/items/:id', validJson(itemUpdateSchema), async (c) => {
    const id = validId(c);
    if (!id) return notFound(c);
    const [item] = await c
      .get('db')
      .update(dealItems)
      .set({ doneAt: c.req.valid('json').done ? new Date() : null })
      .where(eq(dealItems.id, id))
      .returning({ id: dealItems.id });
    return item ? c.json({ ok: true }) : notFound(c);
  })

  .delete('/items/:id', async (c) => {
    const id = validId(c);
    if (!id) return notFound(c);
    const [item] = await c.get('db').delete(dealItems).where(eq(dealItems.id, id)).returning({ id: dealItems.id });
    return item ? c.json({ ok: true }) : notFound(c);
  });
