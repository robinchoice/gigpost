<script lang="ts">
  import type { Deal } from '@app/shared';
  import { page } from '$app/state';
  import { api } from '$lib/api';
  import { artistOf, booking, change, drafts, eventText, openDeadlines, shortDate } from '$lib/booking.svelte';
  import Button from '$lib/components/Button.svelte';
  import { t } from '$lib/i18n';
  import { toast } from '$lib/toast.svelte';

  // The stack is fixed when the page opens: sending or skipping moves on, new
  // drafts from agents wait for the next round. ?draft=<id> opens just one.
  let queue = $state<string[] | null>(null);
  let index = $state(0);
  let sent = $state(0);
  let busy = $state(false);
  let to = $state('');
  let subject = $state('');
  let body = $state('');

  $effect(() => {
    if (queue || !booking.data) return;
    const only = page.url.searchParams.get('draft');
    queue = drafts(booking.data)
      .map((deal) => deal.draft!.id)
      .filter((id) => !only || id === only);
  });

  const current = $derived.by((): Deal | undefined => {
    const id = queue?.[index];
    return booking.data?.deals.find((deal) => deal.draft?.id === id);
  });
  const artist = $derived(current && artistOf(current));
  const followUp = $derived(current?.draft?.kind === 'followup');

  // Fill the form when the next draft comes up
  let shown = '';
  $effect(() => {
    const draft = current?.draft;
    if (!draft || draft.id === shown) return;
    shown = draft.id;
    ({ to, subject, body } = draft);
  });

  // Once a draft is gone (sent, discarded, or by another session), move on
  $effect(() => {
    if (queue && booking.data && index < queue.length && !current) index++;
  });

  async function send() {
    const draft = current?.draft;
    if (!draft || busy || !booking.data?.canSend || !booking.data.from) return;
    busy = true;
    try {
      await change(() => api.post(`/booking/drafts/${draft.id}/send`, { to, subject, body }));
      toast(t().sentTo(to));
      sent++;
    } catch {
      // The API client shows the error, the draft stays
    } finally {
      busy = false;
    }
  }

  async function discard() {
    const draft = current?.draft;
    if (!draft || busy) return;
    busy = true;
    try {
      await change(() => api.delete(`/booking/drafts/${draft.id}`));
      toast(t().discarded);
    } finally {
      busy = false;
    }
  }

  const later = () => index++;

  function onkeydown(e: KeyboardEvent) {
    if (!current) return;
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape') {
      later();
    }
  }
</script>

<svelte:window {onkeydown} />

{#if queue && booking.data}
  {#if queue.length === 0}
    <div class="card finished">
      <p class="muted">{t().noDrafts}</p>
      <Button href="/dashboard">{t().backToToday}</Button>
    </div>
  {:else if index >= queue.length || !current}
    <div class="card finished">
      <h1>{t().reviewDone}</h1>
      <p class="muted">{sent ? t().reviewDoneText(sent) : t().reviewSkipped}</p>
      <Button href="/dashboard">{t().backToToday}</Button>
    </div>
  {:else}
    <div class="head">
      <h1>{followUp ? t().followUpTitle : t().reviewTitle}</h1>
      <span class="muted">{t().position(index + 1, queue.length)}</span>
    </div>
    <div class="progress">
      {#each queue as id, i (id)}<i class:done={i < index} class:cur={i === index}></i>{/each}
    </div>

    <div class="review">
      <section class="card">
        <label class="field" for="to">{t().to}</label>
        <input id="to" class="input" bind:value={to} />
        <label class="field" for="subject">{t().subject}</label>
        <input id="subject" class="input" bind:value={subject} />
        <label class="field" for="body">{t().text}</label>
        <textarea id="body" class="input" bind:value={body}></textarea>
        {#if !booking.data.canSend}
          <p class="note">{t().onlyAdminsSend}</p>
        {:else if !booking.data.from}
          <p class="note">{t().sendingOff}</p>
        {:else}
          <p class="muted small from">{booking.data.from === 'log' ? t().fromLog : t().from(booking.data.from)}</p>
        {/if}
        <div class="actions">
          <Button onclick={send} loading={busy} disabled={!booking.data.canSend || !booking.data.from}>{t().send}</Button>
          <Button variant="secondary" onclick={later}>{t().later}</Button>
          <button type="button" class="ghost-btn" onclick={discard} disabled={busy}>{t().discard}</button>
          <span class="muted small keys">{t().shortcuts}</span>
        </div>
      </section>

      <aside class="card">
        <div class="muted small">
          {[current.venue.city, current.venue.capacity && t().places(current.venue.capacity)].filter(Boolean).join(' · ')}
        </div>
        <h2>{current.venue.name}</h2>
        {#if artist}
          <span class="chip"><span class="dot" style:background={artist.color}></span>{artist.name}</span>
        {/if}
        {#if current.venue.genre}<div class="small muted genre">{current.venue.genre}</div>{/if}
        {#if current.venue.website}
          <a class="small" href={current.venue.website} target="_blank" rel="noopener noreferrer">{current.venue.website}</a>
        {/if}
        {#if current.why && !followUp}
          <div class="why"><b>{t().whyAgent}</b><br />{current.why}</div>
        {/if}
        {#each openDeadlines(current) as item (item.id)}
          <div class="chip warn deadline">{t().deadline(shortDate(item.due!), item.text)}</div>
        {/each}
        <h3>{t().history}</h3>
        <ul class="log">
          {#each current.events as event (event.id)}
            <li><span class="muted">{shortDate(event.at)}</span><span>{eventText(event)}</span></li>
          {:else}
            <li class="muted">{t().firstContact}</li>
          {/each}
        </ul>
      </aside>
    </div>
  {/if}
{/if}

<style>
  .head {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  h1 {
    margin: 0;
    font-size: 1.6rem;
  }
  .progress {
    display: flex;
    gap: 4px;
    margin-top: 10px;
  }
  .progress i {
    flex: 1;
    height: 4px;
    border-radius: 2px;
    background: var(--border);
  }
  .progress i.done {
    background: var(--new-bg);
  }
  .progress i.cur {
    background: var(--text);
  }
  .review {
    display: grid;
    grid-template-columns: 1fr 300px;
    gap: 16px;
    margin-top: 16px;
    align-items: start;
  }
  textarea {
    min-height: 300px;
    resize: vertical;
    line-height: 1.5;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
  }
  .keys {
    margin-left: auto;
  }
  .note {
    margin: 10px 0 0;
    padding: 8px 10px;
    border: 1px solid var(--needs-bg);
    border-radius: var(--radius);
    background: #fdf0d8;
    color: var(--needs);
    font-size: 14px;
  }
  .from {
    margin: 8px 0 0;
  }
  .card h2 {
    margin: 2px 0 6px;
  }
  .genre {
    margin-top: 8px;
  }
  .why {
    margin-top: 10px;
    padding: 10px;
    border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--accent) 8%, white);
    font-size: 14px;
  }
  .deadline {
    margin-top: 10px;
    white-space: normal;
  }
  h3 {
    margin: 18px 0 6px;
    font-family: var(--font-display);
    font-size: 15px;
  }
  .log {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .log li {
    display: flex;
    gap: 10px;
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
    font-size: 14px;
  }
  .log li span:first-child {
    flex: none;
    width: 44px;
  }
  .finished {
    margin-top: 20px;
    padding: 40px;
    text-align: center;
  }
  @media (max-width: 700px) {
    .review {
      grid-template-columns: 1fr;
    }
    .keys {
      display: none;
    }
    .finished {
      padding: 24px;
    }
  }
</style>
