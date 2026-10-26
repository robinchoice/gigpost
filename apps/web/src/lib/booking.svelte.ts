import {
  type Booking,
  type Deal,
  type DealEvent,
  dateLocales,
  type Messages,
  needsFollowUp,
  type Stage,
  stageSchema,
} from '@app/shared';
import { page } from '$app/state';
import { api } from './api';
import { t } from './i18n';

// Everything of the booking desk, loaded once per page and after each change
export const booking = $state<{ data: Booking | null; open: string | null }>({ data: null, open: null });

export async function loadBooking() {
  booking.data = await api.get<Booking>('/booking');
}

// Runs a change, then reloads, so every view shows the same state
export async function change(run: () => Promise<unknown>) {
  try {
    await run();
  } finally {
    await loadBooking();
  }
}

// The detail drawer of a deal
export const openDeal = (id: string) => {
  booking.open = id;
};

export const artistOf = (deal: Deal) => booking.data?.artists.find((artist) => artist.id === deal.artistId);

export const drafts = (data: Booking) =>
  data.deals.filter((deal) => deal.draft).sort((a, b) => a.draft!.createdAt.localeCompare(b.draft!.createdAt));

const DAY = 864e5;
const startOfToday = () => new Date(new Date().toDateString()).getTime();
// Whole days from today to a YYYY-MM-DD date, negative when past
export const daysUntil = (date: string) => Math.round((new Date(`${date}T00:00:00`).getTime() - startOfToday()) / DAY);
// Whole calendar days since a timestamp
export const daysSince = (iso: string) =>
  Math.max(0, Math.round((startOfToday() - new Date(new Date(iso).toDateString()).getTime()) / DAY));

const locale = () => dateLocales[page.data.locale];
// A YYYY-MM-DD day as it is, a timestamp in the browser's time zone
const asDate = (value: string) => new Date(value.length === 10 ? `${value}T00:00:00` : value);
export const shortDate = (value: string) =>
  asDate(value).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit' });
export const longDate = (value: string) =>
  asDate(value).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' });

export function dueLabel(date: string) {
  const days = daysUntil(date);
  const m = t();
  return days < 0 ? m.overdue(-days) : days === 0 ? m.today : days === 1 ? m.tomorrow : m.inDays(days);
}

export const stageLabel = (stage: Stage, m: Messages = t()) =>
  ({
    draft: m.stageDraft,
    asked: m.stageAsked,
    talking: m.stageTalking,
    confirmed: m.stageConfirmed,
    played: m.stagePlayed,
    archived: m.stageArchived,
  })[stage];

export const followUp = (deal: Deal) => needsFollowUp(deal);

// The second line of a card: where the deal stands
export function statusLine(deal: Deal) {
  const m = t();
  switch (deal.stage) {
    case 'draft':
      return m.draftByAgent;
    case 'asked':
      if (!deal.lastSentAt) return m.stageAsked;
      return followUp(deal) ? m.noReplyFor(daysSince(deal.lastSentAt)) : m.sentDaysAgo(daysSince(deal.lastSentAt));
    case 'talking':
      if (deal.replyOpen) return m.replyWaiting;
      return deal.gigDate ? m.option(shortDate(deal.gigDate)) : m.inTalks;
    case 'confirmed':
    case 'played':
      return [deal.gigDate && longDate(deal.gigDate), deal.fee].filter(Boolean).join(' · ') || stageLabel(deal.stage);
    case 'archived':
      return m.stageArchived;
    default: {
      const unhandled: never = deal.stage;
      throw new Error(String(unhandled));
    }
  }
}

export const openDeadlines = (deal: Deal) =>
  deal.items.filter((item) => item.kind === 'deadline' && !item.done && item.due);

// A line of the history in the reader's language
export function eventText(event: DealEvent) {
  const m = t();
  switch (event.kind) {
    case 'request':
      return m.eventRequest(event.text);
    case 'followup':
      return m.eventFollowUp;
    case 'reply':
      return m.eventReply(event.text);
    case 'stage': {
      const stage = stageSchema.safeParse(event.text);
      return m.eventStage(stage.success ? stageLabel(stage.data, m) : event.text);
    }
    default: {
      const unhandled: never = event.kind;
      throw new Error(String(unhandled));
    }
  }
}
