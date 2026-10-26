import { z } from 'zod';

// Stages of a deal in board order. archived holds discarded drafts and
// cancellations, they leave the board but keep the venue from being added again.
export const STAGES = ['draft', 'asked', 'talking', 'confirmed', 'played'] as const;
export const stageSchema = z.enum([...STAGES, 'archived']);
export type Stage = z.infer<typeof stageSchema>;

// Days without a reply after which a request shows up under follow-ups
export const FOLLOW_UP_DAYS = 10;

// How venues are told apart besides their email: name and city, without case,
// accents of the same letter or extra spaces
export const venueKey = (name: string, city: string) =>
  [name, city].map((part) => part.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')).join('|');

const email = z.string().trim().toLowerCase().pipe(z.email('invalidEmail'));
const day = z.iso.date();
const text = (max: number) => z.string().trim().max(max);
// Shown as links, so nothing but http(s), no javascript:
const link = z.url({ protocol: /^https?$/ }).max(1000);

export const artistSchema = z.object({
  name: text(200).min(1),
  kind: text(300).optional(),
  epk: text(500).optional(),
});

export const venueSchema = z.object({
  name: text(200).min(1),
  city: text(200).min(1),
  capacity: z.number().int().positive().max(1_000_000).nullable().optional(),
  genre: text(300).optional(),
  contact: text(200).optional(),
  email: email.nullable().optional(),
  website: z.literal('').or(link.max(500)).optional(),
});

export const draftSchema = z.object({
  venueId: z.uuid(),
  artistId: z.uuid(),
  why: text(2000).optional(),
  // Defaults to the venue's contact and email
  to: text(500).optional(),
  subject: text(300).min(1),
  body: text(20_000).min(1),
});

// What Robin sends after editing the draft
export const sendSchema = z.object({
  to: text(500).min(3),
  subject: text(300).min(1),
  body: text(20_000).min(1),
});

export const dealUpdateSchema = z.object({
  stage: stageSchema.optional(),
  gigDate: day.nullable().optional(),
  fee: text(200).optional(),
  replyOpen: z.boolean().optional(),
});

export const replySchema = z.object({ text: text(1000).optional() });

export const itemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('note'), text: text(1000).min(1) }),
  z.object({ kind: z.literal('deadline'), text: text(1000).min(1), due: day }),
  z.object({ kind: z.literal('doc'), text: text(1000).min(1), url: link.optional() }),
]);

export const itemUpdateSchema = z.object({ done: z.boolean() });

export type Artist = { id: string; name: string; kind: string; epk: string; color: string };

export type Venue = {
  id: string;
  name: string;
  city: string;
  capacity: number | null;
  genre: string;
  contact: string;
  email: string | null;
  website: string;
};

export type Draft = {
  id: string;
  kind: 'request' | 'followup';
  to: string;
  subject: string;
  body: string;
  createdAt: string;
};

export type DealItem = {
  id: string;
  kind: 'note' | 'deadline' | 'doc';
  text: string;
  due: string | null;
  url: string | null;
  done: boolean;
};

export type DealEvent = {
  id: string;
  kind: 'request' | 'followup' | 'reply' | 'stage';
  text: string;
  at: string;
};

export type Deal = {
  id: string;
  venue: Venue;
  artistId: string;
  stage: Stage;
  why: string;
  gigDate: string | null;
  fee: string;
  replyOpen: boolean;
  lastSentAt: string | null;
  lastReplyAt: string | null;
  draft: Draft | null;
  items: DealItem[];
  // Oldest first
  events: DealEvent[];
};

// canSend: the account may send mails to venues (ADMIN_EMAILS). from: the
// sender, null while sending is not set up.
export type Booking = { artists: Artist[]; deals: Deal[]; canSend: boolean; from: string | null };

// A request waits for a reply for FOLLOW_UP_DAYS or more. It stays a follow-up
// while its follow-up draft waits under Drafts.
export function needsFollowUp(deal: Deal, now = new Date()) {
  if (deal.stage !== 'asked' || !deal.lastSentAt) return false;
  if (deal.lastReplyAt && deal.lastReplyAt > deal.lastSentAt) return false;
  return now.getTime() - new Date(deal.lastSentAt).getTime() >= FOLLOW_UP_DAYS * 864e5;
}
