<script lang="ts">
  import { type DealItem, STAGES, type Stage, stageSchema } from '@app/shared';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import {
    artistOf,
    booking,
    change,
    daysUntil,
    eventText,
    followUp,
    shortDate,
    stageLabel,
    statusLine,
  } from '$lib/booking.svelte';
  import { t } from '$lib/i18n';
  import { toast } from '$lib/toast.svelte';

  const deal = $derived(booking.data?.deals.find((d) => d.id === booking.open));
  const artist = $derived(deal && artistOf(deal));
  const items = (kind: DealItem['kind']) => deal?.items.filter((item) => item.kind === kind) ?? [];

  let gigDate = $state('');
  let fee = $state('');
  let note = $state('');
  let deadlineText = $state('');
  let deadlineDue = $state('');
  let docText = $state('');
  let docUrl = $state('');
  let replyText = $state('');
  let replying = $state(false);

  // Fresh fields for every deal that opens
  let shown = '';
  $effect(() => {
    if (!deal || deal.id === shown) return;
    shown = deal.id;
    gigDate = deal.gigDate ?? '';
    fee = deal.fee;
    note = deadlineText = deadlineDue = docText = docUrl = replyText = '';
    replying = false;
  });

  const close = () => {
    booking.open = null;
    shown = '';
  };
  const path = () => `/booking/deals/${deal!.id}`;

  const update = (body: object) => change(() => api.patch(path(), body));
  const setStage = (stage: Stage) => update({ stage });
  const saveAgreed = () => update({ gigDate: gigDate || null, fee });

  async function addItem(body: object, reset: () => void) {
    await change(() => api.post(`${path()}/items`, body));
    reset();
  }

  async function reply() {
    await change(() => api.post(`${path()}/reply`, { text: replyText }));
    toast(t().markedReplied);
    replying = false;
    replyText = '';
  }

  async function followUpMail() {
    let id = deal!.draft?.id;
    if (!id) await change(async () => (id = (await api.post<{ draftId: string }>(`${path()}/followup`)).draftId));
    close();
    goto(`/drafts?draft=${id}`);
  }

  async function decline() {
    await setStage('archived');
    toast(t().declined);
  }

  const onkeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && deal) close();
  };
</script>

<svelte:window {onkeydown} />

{#if deal}
  <button type="button" class="backdrop" aria-label={t().close} onclick={close}></button>
  <div class="drawer" role="dialog" aria-modal="true" aria-labelledby="deal-title" data-feedback-ignore>
    <button type="button" class="ghost-btn close" aria-label={t().close} onclick={close}>✕</button>
    <div class="muted small">
      {[deal.venue.city, deal.venue.capacity && t().places(deal.venue.capacity), deal.venue.genre]
        .filter(Boolean)
        .join(' · ')}
    </div>
    <h2 id="deal-title">{deal.venue.name}</h2>
    <div class="chips">
      {#if artist}<span class="chip"><span class="dot" style:background={artist.color}></span>{artist.name}</span>{/if}
      <label class="chip stage">
        <span class="sr">{t().stage}</span>
        <select value={deal.stage} onchange={(e) => setStage(stageSchema.parse(e.currentTarget.value))}>
          {#each [...STAGES, 'archived' as const] as stage (stage)}
            <option value={stage}>{stageLabel(stage)}</option>
          {/each}
        </select>
      </label>
      <span class="chip" class:warn={followUp(deal)} class:ok={deal.replyOpen}>{statusLine(deal)}</span>
    </div>

    <section>
      <h3>{t().contact}</h3>
      <div>
        {deal.venue.contact || '–'}
        {#if deal.venue.email}· <a href="mailto:{deal.venue.email}">{deal.venue.email}</a>{/if}
      </div>
      {#if deal.venue.website}
        <a class="small" href={deal.venue.website} target="_blank" rel="noopener noreferrer">{deal.venue.website}</a>
      {/if}
    </section>

    {#if deal.why}
      <section>
        <h3>{t().whyAgent}</h3>
        <p class="why">{deal.why}</p>
      </section>
    {/if}

    <section>
      <h3>{t().agreed}</h3>
      <div class="pair">
        <label>
          <span class="field">{t().gigDate}</span>
          <input class="input" type="date" bind:value={gigDate} onchange={saveAgreed} />
        </label>
        <label>
          <span class="field">{t().fee}</span>
          <input class="input" bind:value={fee} onchange={saveAgreed} placeholder="600 € + Hotel" />
        </label>
      </div>
    </section>

    <section>
      <h3>{t().notes}</h3>
      <ul class="plain">
        {#each items('note') as item (item.id)}
          <li>
            <span>{item.text}</span>
            <button type="button" class="ghost-btn" aria-label={t().remove} onclick={() => change(() => api.delete(`/booking/items/${item.id}`))}>✕</button>
          </li>
        {/each}
      </ul>
      <form
        class="add"
        onsubmit={(e) => {
          e.preventDefault();
          addItem({ kind: 'note', text: note }, () => (note = ''));
        }}
      >
        <input class="input" bind:value={note} placeholder={t().addNote} required />
        <button type="submit" class="small-btn">{t().add}</button>
      </form>
    </section>

    <section>
      <h3>{t().deadlines}</h3>
      {#each items('deadline') as item (item.id)}
        <div class="item" class:done={item.done}>
          <input
            type="checkbox"
            checked={item.done}
            aria-label={t().replyHandled}
            onchange={(e) => change(() => api.patch(`/booking/items/${item.id}`, { done: e.currentTarget.checked }))}
          />
          {#if item.due}<span class="chip" class:warn={!item.done && daysUntil(item.due) <= 3}>{shortDate(item.due)}</span>{/if}
          <span class="grow">{item.text}</span>
          <button type="button" class="ghost-btn" aria-label={t().remove} onclick={() => change(() => api.delete(`/booking/items/${item.id}`))}>✕</button>
        </div>
      {:else}
        <div class="muted small">{t().noDeadlines}</div>
      {/each}
      <form
        class="add"
        onsubmit={(e) => {
          e.preventDefault();
          addItem({ kind: 'deadline', text: deadlineText, due: deadlineDue }, () => (deadlineText = deadlineDue = ''));
        }}
      >
        <input class="input" bind:value={deadlineText} placeholder={t().what} aria-label={t().addDeadline} required />
        <input class="input date" type="date" bind:value={deadlineDue} aria-label={t().due} required />
        <button type="submit" class="small-btn">{t().add}</button>
      </form>
    </section>

    <section>
      <h3>{t().documents}</h3>
      {#each items('doc') as item (item.id)}
        <div class="item doc">
          📄
          {#if item.url}
            <a class="grow" href={item.url} target="_blank" rel="noopener noreferrer">{item.text}</a>
          {:else}
            <span class="grow">{item.text}</span>
          {/if}
          <button type="button" class="ghost-btn" aria-label={t().remove} onclick={() => change(() => api.delete(`/booking/items/${item.id}`))}>✕</button>
        </div>
      {:else}
        <div class="muted small">{t().noDocuments}</div>
      {/each}
      <form
        class="add"
        onsubmit={(e) => {
          e.preventDefault();
          addItem({ kind: 'doc', text: docText, url: docUrl || undefined }, () => (docText = docUrl = ''));
        }}
      >
        <input class="input" bind:value={docText} placeholder={t().docTitle} aria-label={t().addDocument} required />
        <input class="input" type="url" bind:value={docUrl} placeholder={t().docUrl} aria-label={t().docUrl} />
        <button type="submit" class="small-btn">{t().add}</button>
      </form>
    </section>

    <section>
      <h3>{t().history}</h3>
      <ul class="log">
        {#each deal.events as event (event.id)}
          <li>
            <span class="muted">{shortDate(event.at)}</span>
            <span>{event.kind === 'reply' ? '↘' : event.kind === 'stage' ? '•' : '↗'}</span>
            <span>{eventText(event)}</span>
          </li>
        {:else}
          <li class="muted">{t().nothingSent}</li>
        {/each}
      </ul>
    </section>

    {#if replying}
      <form
        class="add reply"
        onsubmit={(e) => {
          e.preventDefault();
          reply();
        }}
      >
        <input class="input" bind:value={replyText} placeholder={t().replySummary} aria-label={t().replySummary} />
        <button type="submit" class="small-btn">{t().replyReceived}</button>
      </form>
    {/if}
    <section class="actions">
      {#if !replying}<button type="button" class="small-btn" onclick={() => (replying = true)}>{t().replyReceived}</button>{/if}
      {#if deal.replyOpen}
        <button type="button" class="small-btn" onclick={() => update({ replyOpen: false })}>{t().replyHandled}</button>
      {/if}
      {#if deal.lastSentAt && deal.stage !== 'archived'}
        <button type="button" class="small-btn" onclick={followUpMail}>{t().followUpMail}</button>
      {/if}
      {#if deal.stage !== 'archived'}
        <button type="button" class="ghost-btn" onclick={decline}>{t().decline}</button>
      {/if}
    </section>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 49;
    border: 0;
    background: rgb(23 23 26 / 0.18);
    cursor: default;
  }
  .drawer {
    position: fixed;
    inset: 0 0 0 auto;
    z-index: 50;
    width: min(460px, 100%);
    padding: 20px;
    overflow: auto;
    border-left: 1px solid var(--border);
    background: var(--surface);
    box-shadow: -8px 0 30px rgb(0 0 0 / 0.08);
  }
  .close {
    position: absolute;
    top: 14px;
    right: 14px;
  }
  h2 {
    margin: 4px 0 0;
    font-size: 1.5rem;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
  .stage select {
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  section {
    margin-top: 18px;
  }
  h3 {
    margin: 0 0 6px;
    font-family: var(--font-display);
    font-size: 15px;
  }
  .why {
    margin: 0;
    font-size: 14px;
  }
  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .pair .field {
    margin-top: 0;
  }
  .plain {
    margin: 0;
    padding-left: 18px;
  }
  .plain li span {
    margin-right: 4px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-size: 14px;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .item.done .grow {
    color: var(--muted);
    text-decoration: line-through;
  }
  .item.doc {
    border-style: dashed;
  }
  .add {
    display: flex;
    gap: 6px;
    margin-top: 6px;
  }
  .add .input {
    padding: 6px 8px;
    font-size: 14px;
  }
  .add .date {
    width: 150px;
    flex: none;
  }
  .reply {
    margin-top: 18px;
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
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  @media (max-width: 700px) {
    .add {
      flex-wrap: wrap;
    }
    .add .date {
      width: auto;
      flex: 1;
    }
  }
</style>
