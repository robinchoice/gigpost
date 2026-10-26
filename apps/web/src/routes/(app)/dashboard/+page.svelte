<script lang="ts">
  import { type Deal, dateLocales } from '@app/shared';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api } from '$lib/api';
  import { auth } from '$lib/auth.svelte';
  import {
    artistOf,
    booking,
    change,
    daysUntil,
    drafts,
    dueLabel,
    followUp,
    longDate,
    openDeadlines,
    openDeal,
    shortDate,
    statusLine,
  } from '$lib/booking.svelte';
  import { t } from '$lib/i18n';

  const now = new Date();
  const today = $derived(
    now.toLocaleDateString(dateLocales[page.data.locale], { weekday: 'long', day: 'numeric', month: 'long' }),
  );
  const data = $derived(booking.data);
  const waiting = $derived(data ? drafts(data).length : 0);
  const replies = $derived(data?.deals.filter((deal) => deal.replyOpen && deal.stage !== 'archived') ?? []);
  const followUps = $derived(data?.deals.filter(followUp) ?? []);
  const deadlines = $derived(
    (data?.deals ?? [])
      .filter((deal) => deal.stage !== 'archived')
      .flatMap((deal) => openDeadlines(deal).map((item) => ({ ...item, due: item.due!, deal })))
      .sort((a, b) => a.due.localeCompare(b.due)),
  );
  const gigs = $derived(
    (data?.deals ?? [])
      .filter((deal) => deal.stage === 'confirmed' && deal.gigDate && daysUntil(deal.gigDate) >= 0)
      .sort((a, b) => a.gigDate!.localeCompare(b.gigDate!)),
  );

  const lastReply = (deal: Deal) => deal.events.findLast((event) => event.kind === 'reply')?.text;

  async function followUpMail(deal: Deal) {
    let id = deal.draft?.id;
    if (!id) await change(async () => (id = (await api.post<{ draftId: string }>(`/booking/deals/${deal.id}/followup`)).draftId));
    goto(`/drafts?draft=${id}`);
  }
</script>

<div class="muted small date">{today}</div>
<h1>{t().greeting(now.getHours(), auth.user?.name ?? '')}</h1>

{#if data}
  <section class="hero">
    <div>
      <div class="big">{t().draftCount(waiting)}</div>
      <div class="lead">{t().draftsWaiting(waiting)}</div>
    </div>
    {#if waiting}<a class="go" href="/drafts">{t().goThrough}</a>{/if}
  </section>

  <div class="grid">
    <div class="stack">
      <section class="card">
        <h2>{t().replies} <span class="count-pill">{replies.length}</span></h2>
        {#each replies as deal (deal.id)}
          <button type="button" class="row" onclick={() => openDeal(deal.id)}>
            <span class="dot" style:background={artistOf(deal)?.color}></span>
            <span class="grow">
              <span class="title">{deal.venue.name}, {deal.venue.city}</span>
              <span class="sub">{lastReply(deal) || t().replyReceived}</span>
            </span>
            <span class="chip ok">{t().replyNew}</span>
          </button>
        {:else}
          <div class="empty">{t().nothingOpen}</div>
        {/each}
      </section>

      <section class="card">
        <h2>{t().followUps} <span class="count-pill">{followUps.length}</span></h2>
        {#each followUps as deal (deal.id)}
          <div class="row">
            <span class="dot" style:background={artistOf(deal)?.color}></span>
            <button type="button" class="grow open plain" onclick={() => openDeal(deal.id)}>
              <span class="title">{deal.venue.name}, {deal.venue.city}</span>
              <span class="sub">{statusLine(deal)} · {artistOf(deal)?.name}</span>
            </button>
            <button type="button" class="small-btn" onclick={() => followUpMail(deal)}>{t().followUpMail}</button>
          </div>
        {:else}
          <div class="empty">{t().nothingOpen}</div>
        {/each}
      </section>
    </div>

    <section class="card">
      <h2>{t().deadlines} <span class="count-pill">{deadlines.length}</span></h2>
      {#each deadlines as item (item.id)}
        <button type="button" class="row" onclick={() => openDeal(item.deal.id)}>
          <span class="grow">
            <span class="title">{item.text}</span>
            <span class="sub">{item.deal.venue.name} · {shortDate(item.due)}</span>
          </span>
          <span class="chip" class:warn={daysUntil(item.due) <= 3}>{dueLabel(item.due)}</span>
        </button>
      {:else}
        <div class="empty">{t().nothingOpen}</div>
      {/each}

      <h2 class="gigs">{t().nextGigs}</h2>
      {#each gigs as deal (deal.id)}
        <button type="button" class="row" onclick={() => openDeal(deal.id)}>
          <span class="grow">
            <span class="title">{longDate(deal.gigDate!)} · {deal.venue.name}</span>
            <span class="sub">{[artistOf(deal)?.name, deal.fee].filter(Boolean).join(' · ')}</span>
          </span>
        </button>
      {:else}
        <div class="empty">{t().nothingOpen}</div>
      {/each}
    </section>
  </div>
{/if}

<style>
  .date {
    text-transform: capitalize;
  }
  h1 {
    margin: 0.2rem 0 0;
    font-size: 1.8rem;
  }
  .hero {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-top: 16px;
    padding: 18px;
    border-radius: var(--radius);
    background: var(--text);
    color: #fff;
  }
  .big {
    font-family: var(--font-display);
    font-size: 2rem;
    font-weight: 750;
    font-stretch: 80%;
  }
  .lead {
    opacity: 0.8;
  }
  .go {
    flex: none;
    padding: 10px 16px;
    border-radius: var(--radius);
    background: var(--gradient);
    color: #17171a;
    font-weight: 600;
    text-decoration: none;
  }
  .grid {
    display: grid;
    grid-template-columns: 1.3fr 1fr;
    gap: 16px;
    margin-top: 16px;
    align-items: start;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .row .grow {
    display: flex;
    flex-direction: column;
  }
  .plain {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
  }
  .card .gigs {
    margin-top: 18px;
  }
  @media (max-width: 700px) {
    .grid {
      grid-template-columns: 1fr;
    }
    .hero {
      flex-direction: column;
      align-items: stretch;
    }
    .go {
      text-align: center;
    }
    .big {
      font-size: 1.6rem;
    }
  }
</style>
