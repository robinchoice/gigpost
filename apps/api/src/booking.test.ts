import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import { createDb, dealEvents, deals, migrateDb, users } from '@app/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createApp } from './app';
import { issueSession } from './lib/login';
import { body, read } from './testing';

const db = createDb(process.env.DATABASE_URL);
const app = createApp(db);
const log = spyOn(console, 'log').mockImplementation(() => {});

beforeAll(() => migrateDb(process.env.DATABASE_URL));
afterAll(() => {
  delete process.env.ADMIN_EMAILS;
  return db.$client.end();
});

const ADMIN = `admin-${crypto.randomUUID()}@example.com`;
process.env.ADMIN_EMAILS = ADMIN;
const unique = () => crypto.randomUUID().slice(0, 8);

async function session(email: string) {
  const [user] = await db.insert(users).values({ email, name: 'Robin' }).returning({ id: users.id });
  return { cookie: `session=${await issueSession(db, user!.id)}` };
}
const agent = await session(`agent-${unique()}@example.com`);
const robin = await session(ADMIN);

function request(method: string, path: string, headers: Record<string, string>, data?: unknown) {
  return app.request(`/api/v1/booking${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': unique(), ...headers },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
}

const withId = z.object({ id: z.string() });
const artistAnswer = z.object({ artist: withId });
const venueAnswer = z.object({ venue: withId });
// The parts of GET /booking the tests read
const bookingAnswer = z.object({
  canSend: z.boolean(),
  deals: z.array(
    z.object({
      id: z.string(),
      draft: z.object({ kind: z.string(), subject: z.string(), to: z.string(), body: z.string() }).nullable(),
      items: z.array(z.object({ kind: z.string() })),
    }),
  ),
});
const created = z.object({ dealId: z.string(), draftId: z.string() });
const mails = () => log.mock.calls.map((args) => String(args[0])).filter((line) => line.startsWith('[booking-mail]'));

async function artistAndVenue(email = `booking-${unique()}@venue.example`) {
  const { artist } = await read(request('POST', '/artists', agent, { name: `Band ${unique()}` }), artistAnswer);
  const name = `Club ${unique()}`;
  const { venue } = await read(
    request('POST', '/venues', agent, { name, city: 'Freiburg', email, contact: 'Jana Wirth' }),
    venueAnswer,
  );
  return { artistId: artist.id, venueId: venue.id, name, email };
}

const draft = (ids: { artistId: string; venueId: string }) =>
  request('POST', '/drafts', agent, { ...ids, why: 'Passt', subject: 'Anfrage', body: 'Hallo Jana' });

test('the board needs a login', async () => {
  expect((await app.request('/api/v1/booking')).status).toBe(401);
});

test('a venue exists once, by email or by name and city', async () => {
  const { name, email, venueId } = await artistAndVenue();
  const sameMail = await request('POST', '/venues', agent, {
    name: 'Anderer Name',
    city: 'Basel',
    email: email.toUpperCase(),
  });
  expect(sameMail.status).toBe(409);
  expect(await body(sameMail)).toEqual({ error: expect.stringContaining(venueId) });
  const sameName = await request('POST', '/venues', agent, { name: ` ${name.toUpperCase()} `, city: 'freiburg' });
  expect(sameName.status).toBe(409);
});

test('an artist gets one deal per venue, a second artist another', async () => {
  const ids = await artistAndVenue();
  expect((await draft(ids)).status).toBe(200);
  expect((await draft(ids)).status).toBe(409);
  const { artist } = await read(request('POST', '/artists', agent, { name: `Solo ${unique()}` }), artistAnswer);
  expect((await draft({ ...ids, artistId: artist.id })).status).toBe(200);
});

test('only admins send, the deal moves to asked and a follow-up answers in the thread', async () => {
  const ids = await artistAndVenue();
  const { dealId, draftId } = await read(draft(ids), created);
  const mail = { to: 'admin@pleasance.org', subject: 'Anfrage Frühjahr', body: 'Hallo Jana' };

  expect((await request('POST', `/drafts/${draftId}/send`, agent, mail)).status).toBe(403);
  expect((await request('POST', `/drafts/${draftId}/send`, robin, mail)).status).toBe(200);
  expect(mails().at(-1)).toStartWith('[booking-mail] To admin@pleasance.org: Anfrage Frühjahr');
  // The draft is gone, a second click sends nothing
  expect((await request('POST', `/drafts/${draftId}/send`, robin, mail)).status).toBe(404);

  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
  expect(deal).toMatchObject({ stage: 'asked', lastSentAt: expect.any(Date) });

  const { draftId: followUp } = await read(
    request('POST', `/deals/${dealId}/followup`, agent),
    z.object({ draftId: z.string() }),
  );
  const booking = await read(request('GET', '', robin), bookingAnswer);
  const shown = booking.deals.find((d) => d.id === dealId)!;
  expect(shown.draft).toMatchObject({
    kind: 'followup',
    subject: 'Re: Anfrage Frühjahr',
    to: `Jana Wirth <${ids.email}>`,
  });
  expect(shown.draft!.body).toStartWith('Hallo Jana,');
  expect((await request('POST', `/deals/${dealId}/followup`, agent)).status).toBe(409);
  expect(
    (await request('POST', `/drafts/${followUp}/send`, robin, { ...mail, subject: 'Re: Anfrage Frühjahr' })).status,
  ).toBe(200);
  const events = await db.select().from(dealEvents).where(eq(dealEvents.dealId, dealId));
  expect(events.map((e) => e.kind)).toEqual(['request', 'followup']);
});

test('a reply moves the deal into talks until Robin marks it done', async () => {
  const ids = await artistAndVenue();
  const { dealId, draftId } = await read(draft(ids), created);
  await request('POST', `/drafts/${draftId}/send`, robin, { to: 'admin@pleasance.org', subject: 'A', body: 'B' });
  await request('POST', `/deals/${dealId}/reply`, robin, { text: 'Im April?' });
  let [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
  expect(deal).toMatchObject({ stage: 'talking', replyOpen: true });

  await request('PATCH', `/deals/${dealId}`, robin, {
    replyOpen: false,
    gigDate: '2027-04-10',
    fee: '400 €',
    stage: 'confirmed',
  });
  [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
  expect(deal).toMatchObject({ stage: 'confirmed', replyOpen: false, gigDate: '2027-04-10', fee: '400 €' });
  expect((await request('PATCH', `/deals/${dealId}`, robin, { gigDate: '10.04.2027' })).status).toBe(400);
});

test('discarding a request archives the deal, so the venue is not suggested again', async () => {
  const ids = await artistAndVenue();
  const { dealId, draftId } = await read(draft(ids), created);
  expect((await request('DELETE', `/drafts/${draftId}`, agent)).status).toBe(200);
  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
  expect(deal?.stage).toBe('archived');
  expect((await draft(ids)).status).toBe(409);
});

test('notes, deadlines and document links belong to a deal', async () => {
  const ids = await artistAndVenue();
  const { dealId } = await read(draft(ids), created);
  const add = (data: object) => request('POST', `/deals/${dealId}/items`, robin, data);
  expect((await add({ kind: 'deadline', text: 'Rider schicken', due: '2026-11-01' })).status).toBe(200);
  expect((await add({ kind: 'doc', text: 'Vertrag', url: 'https://cloud.example/v.pdf' })).status).toBe(200);
  expect((await add({ kind: 'doc', text: 'Vertrag', url: 'javascript:alert(1)' })).status).toBe(400);
  const { itemId } = await read(add({ kind: 'note', text: 'Hotel bucht das Haus' }), z.object({ itemId: z.string() }));
  expect((await request('PATCH', `/items/${itemId}`, robin, { done: true })).status).toBe(200);
  expect((await request('DELETE', `/items/${itemId}`, robin)).status).toBe(200);

  const booking = await read(request('GET', '', robin), bookingAnswer);
  const items = booking.deals.find((d) => d.id === dealId)!.items;
  expect(items.map((item) => item.kind).sort()).toEqual(['deadline', 'doc']);
  expect(booking.canSend).toBe(true);
  expect((await read(request('GET', '', agent), bookingAnswer)).canSend).toBe(false);
});
