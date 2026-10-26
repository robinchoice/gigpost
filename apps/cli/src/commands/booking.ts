import { type Messages, stageSchema } from '@app/shared';
import { z } from 'zod';
import { type Command, type Context, EXIT, Failure, str } from '../command';
import { SLUG } from '../config';

// The booking desk for agents: they add artists, venues and drafts, Robin
// goes through the drafts in the web and sends them. Sending has no command,
// the API only lets admins send and agents never log in as one.

const artistSchema = z.object({ id: z.string(), name: z.string(), kind: z.string(), epk: z.string() });
const venueSchema = z.object({
  id: z.string(),
  name: z.string(),
  city: z.string(),
  capacity: z.number().nullable(),
  genre: z.string(),
  contact: z.string(),
  email: z.string().nullable(),
  website: z.string(),
});
const dealSchema = z.object({
  id: z.string(),
  venue: venueSchema,
  artistId: z.string(),
  stage: stageSchema,
  why: z.string(),
  draft: z.object({ id: z.string(), kind: z.string(), to: z.string(), subject: z.string() }).nullable(),
});
const bookingSchema = z.object({ artists: z.array(artistSchema), deals: z.array(dealSchema) });

const needLogin = ({ session, m }: Context) => {
  if (!session) throw new Failure(m.notLoggedIn, EXIT.loggedOut);
};
const required = (ctx: Context, name: string) => {
  const value = str(ctx.values[name])?.trim();
  if (!value) throw new Failure(ctx.m.cliBadOptions(`--${name}`, SLUG), EXIT.usage);
  return value;
};
const optional = (ctx: Context, name: string) => str(ctx.values[name])?.trim() || undefined;

// An artist by id or name, without case
async function findArtist(ctx: Context, value: string) {
  const { artists } = await ctx.api.get('/booking', bookingSchema);
  const artist = artists.find((a) => a.id === value || a.name.toLowerCase() === value.toLowerCase());
  if (!artist) throw new Failure(ctx.m.cliUnknownArtist(value), EXIT.error);
  return artist;
}

const stageName = (m: Messages, stage: z.infer<typeof stageSchema>) =>
  ({
    draft: m.stageDraft,
    asked: m.stageAsked,
    talking: m.stageTalking,
    confirmed: m.stageConfirmed,
    played: m.stagePlayed,
    archived: m.stageArchived,
  })[stage];

const artists: Command = {
  help: (m) => [['artists', m.cliArtistsHelp]],
  async run(ctx) {
    needLogin(ctx);
    const { artists } = await ctx.api.get('/booking', bookingSchema);
    const lines = artists.map((a) => `${a.id}  ${a.name}${a.kind ? ` (${a.kind})` : ''}`);
    return { data: { artists }, text: lines.join('\n') || ctx.m.cliNoneYet };
  },
};

const artistAdd: Command = {
  help: (m) => [['artist-add --name <name> [--kind <text>] [--epk <link>]', m.cliArtistAddHelp]],
  options: { name: { type: 'string' }, kind: { type: 'string' }, epk: { type: 'string' } },
  async run(ctx) {
    const name = required(ctx, 'name');
    needLogin(ctx);
    const { artist } = await ctx.api.post('/booking/artists', z.object({ artist: artistSchema }), {
      name,
      kind: optional(ctx, 'kind'),
      epk: optional(ctx, 'epk'),
    });
    return { data: { artist }, text: ctx.m.cliArtistAdded(artist.name, artist.id) };
  },
};

// Agents look here before they search, so they skip what is already in
const venues: Command = {
  help: (m) => [['venues [--artist <id|name>]', m.cliVenuesHelp]],
  options: { artist: { type: 'string' } },
  async run(ctx) {
    needLogin(ctx);
    const booking = await ctx.api.get('/booking', bookingSchema);
    const filter = optional(ctx, 'artist');
    const artist = filter ? await findArtist(ctx, filter) : null;
    const name = (id: string) => booking.artists.find((a) => a.id === id)?.name ?? '';
    // Venues without a deal show too, with their deals listed if there are any
    const list = [...new Map(booking.deals.map((deal) => [deal.venue.id, deal.venue])).values()];
    const venuesWithDeals = list
      .map((venue) => ({
        ...venue,
        deals: booking.deals
          .filter((deal) => deal.venue.id === venue.id && (!artist || deal.artistId === artist.id))
          .map(({ id, artistId, stage, why }) => ({ id, artistId, artist: name(artistId), stage, why })),
      }))
      .filter((venue) => !artist || venue.deals.length > 0);
    const text = venuesWithDeals
      .map(
        (venue) =>
          `${venue.id}  ${venue.name}, ${venue.city}${venue.email ? ` <${venue.email}>` : ''}\n${venue.deals
            .map((deal) => `    ${deal.artist}: ${stageName(ctx.m, deal.stage)}`)
            .join('\n')}`,
      )
      .join('\n');
    return { data: { venues: venuesWithDeals }, text: text || ctx.m.cliNoneYet };
  },
};

const venueAdd: Command = {
  help: (m) => [
    ['venue-add --name <name> --city <city> [--email --contact --capacity --genre --website]', m.cliVenueAddHelp],
  ],
  options: {
    name: { type: 'string' },
    city: { type: 'string' },
    email: { type: 'string' },
    contact: { type: 'string' },
    capacity: { type: 'string' },
    genre: { type: 'string' },
    website: { type: 'string' },
  },
  async run(ctx) {
    const name = required(ctx, 'name');
    const city = required(ctx, 'city');
    const capacityText = optional(ctx, 'capacity');
    const capacity = capacityText === undefined ? undefined : Number(capacityText);
    if (capacity !== undefined && !Number.isInteger(capacity)) {
      throw new Failure(ctx.m.cliBadOptions('--capacity <n>', SLUG), EXIT.usage);
    }
    needLogin(ctx);
    const { venue } = await ctx.api.post('/booking/venues', z.object({ venue: venueSchema }), {
      name,
      city,
      capacity,
      email: optional(ctx, 'email'),
      contact: optional(ctx, 'contact'),
      genre: optional(ctx, 'genre'),
      website: optional(ctx, 'website'),
    });
    return { data: { venue }, text: ctx.m.cliVenueAdded(`${venue.name}, ${venue.city}`, venue.id) };
  },
};

const drafts: Command = {
  help: (m) => [['drafts', m.cliDraftsHelp]],
  async run(ctx) {
    needLogin(ctx);
    const booking = await ctx.api.get('/booking', bookingSchema);
    const list = booking.deals
      .filter((deal) => deal.draft)
      .map((deal) => ({
        ...deal.draft!,
        dealId: deal.id,
        venue: `${deal.venue.name}, ${deal.venue.city}`,
        artist: booking.artists.find((a) => a.id === deal.artistId)?.name ?? '',
      }));
    const text = list.map((d) => `${d.id}  ${d.venue} · ${d.artist}\n    ${d.subject}`).join('\n');
    return { data: { drafts: list }, text: text || ctx.m.cliNoneYet };
  },
};

const draftAdd: Command = {
  help: (m) => [
    ['draft-add --venue <id> --artist <id|name> --subject <text> --body <text|-> [--why --to]', m.cliDraftAddHelp],
  ],
  options: {
    venue: { type: 'string' },
    artist: { type: 'string' },
    subject: { type: 'string' },
    body: { type: 'string' },
    why: { type: 'string' },
    to: { type: 'string' },
  },
  async run(ctx) {
    const venueId = required(ctx, 'venue');
    const artistName = required(ctx, 'artist');
    const subject = required(ctx, 'subject');
    const bodyOption = required(ctx, 'body');
    needLogin(ctx);
    const body = bodyOption === '-' ? (await ctx.io.stdin()).trim() : bodyOption;
    const artist = await findArtist(ctx, artistName);
    const created = await ctx.api.post('/booking/drafts', z.object({ dealId: z.string(), draftId: z.string() }), {
      venueId,
      artistId: artist.id,
      subject,
      body,
      why: optional(ctx, 'why'),
      to: optional(ctx, 'to'),
    });
    return { data: created, text: ctx.m.cliDraftAdded(created.draftId) };
  },
};

export const booking = {
  artists,
  'artist-add': artistAdd,
  venues,
  'venue-add': venueAdd,
  drafts,
  'draft-add': draftAdd,
};
