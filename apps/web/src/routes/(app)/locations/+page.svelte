<script lang="ts">
  import { type Deal, STAGES, type Stage } from '@app/shared';
  import { api } from '$lib/api';
  import {
    artistOf,
    booking,
    change,
    daysUntil,
    followUp,
    openDeadlines,
    openDeal,
    shortDate,
    stageLabel,
    statusLine,
  } from '$lib/booking.svelte';
  import { t } from '$lib/i18n';

  // 'all' or an artist id
  let filter = $state('all');
  // The column shown on phones
  let column = $state<Stage>('draft');
  let showArchive = $state(false);
  let dragging = $state<string | null>(null);
  let over = $state<Stage | null>(null);

  const list = $derived(
    (booking.data?.deals ?? []).filter((deal) => filter === 'all' || deal.artistId === filter),
  );
  const inStage = (stage: Stage) => list.filter((deal) => deal.stage === stage);

  async function move(deal: Deal, stage: Stage) {
    if (deal.stage === stage) return;
    await change(() => api.patch(`/booking/deals/${deal.id}`, { stage }));
  }

  function drop(stage: Stage) {
    const deal = list.find((d) => d.id === dragging);
    dragging = null;
    over = null;
    if (deal) move(deal, stage);
  }
</script>

{#snippet card(deal: Deal)}
  {@const artist = artistOf(deal)}
  {@const deadline = openDeadlines(deal)[0]}
  <button
    type="button"
    class="k"
    draggable="true"
    style:--c={artist?.color}
    ondragstart={(e) => {
      dragging = deal.id;
      e.dataTransfer?.setData('text/plain', deal.id);
    }}
    ondragend={() => (dragging = null)}
    onclick={() => openDeal(deal.id)}
  >
    <span class="t">{deal.venue.name}</span>
    <span class="s">{deal.venue.city} · {artist?.name}</span>
    <span class="s">{statusLine(deal)}</span>
    {#if followUp(deal) || deal.replyOpen || deadline}
      <span class="foot">
        {#if followUp(deal)}<span class="chip warn">{t().followUps}</span>{/if}
        {#if deal.replyOpen}<span class="chip ok">{t().replyChip}</span>{/if}
        {#if deadline}
          <span class="chip" class:warn={daysUntil(deadline.due!) <= 3}>⏱ {shortDate(deadline.due!)}</span>
        {/if}
      </span>
    {/if}
  </button>
{/snippet}

<div class="head">
  <h1>{t().navLocations}</h1>
</div>

{#if booking.data}
  <div class="filters">
    <button type="button" class="chip" class:on={filter === 'all'} onclick={() => (filter = 'all')}>{t().allArtists}</button>
    {#each booking.data.artists as artist (artist.id)}
      <button type="button" class="chip" class:on={filter === artist.id} onclick={() => (filter = artist.id)}>
        <span class="dot" style:background={artist.color}></span>{artist.name}
      </button>
    {/each}
    <button type="button" class="chip archive" class:on={showArchive} onclick={() => (showArchive = !showArchive)}>
      {t().stageArchived} {inStage('archived').length}
    </button>
  </div>
  {#if booking.data.artists.length === 0}<p class="muted">{t().noArtists}</p>{/if}

  <div class="tabs">
    {#each STAGES as stage (stage)}
      <button type="button" class="chip" class:on={column === stage} onclick={() => (column = stage)}>
        {stageLabel(stage)} {inStage(stage).length}
      </button>
    {/each}
  </div>

  <div class="board">
    {#each STAGES as stage (stage)}
      <section
        class="col"
        class:on={column === stage}
        class:over={over === stage}
        aria-label={stageLabel(stage)}
        ondragover={(e) => {
          e.preventDefault();
          over = stage;
        }}
        ondragleave={() => (over = null)}
        ondrop={(e) => {
          e.preventDefault();
          drop(stage);
        }}
      >
        <h3>{stageLabel(stage)}<span class="muted">{inStage(stage).length}</span></h3>
        {#each inStage(stage) as deal (deal.id)}{@render card(deal)}{/each}
      </section>
    {/each}
  </div>

  {#if showArchive}
    <section class="archived">
      <h3>{t().stageArchived}</h3>
      <div class="archive-list">
        {#each inStage('archived') as deal (deal.id)}{@render card(deal)}{:else}<p class="muted">{t().cliNoneYet}</p>{/each}
      </div>
    </section>
  {/if}

  <p class="small muted">{t().dragHint}</p>
{/if}

<style>
  .head h1 {
    margin: 0;
    font-size: 1.6rem;
  }
  .filters,
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 14px 0;
  }
  .filters .chip,
  .tabs .chip {
    padding: 4px 10px;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .chip.on {
    border-color: var(--text);
    background: var(--text);
    color: #fff;
  }
  .archive {
    margin-left: auto;
  }
  .tabs {
    display: none;
  }
  .board {
    display: grid;
    grid-template-columns: repeat(5, minmax(170px, 1fr));
    gap: 10px;
    overflow-x: auto;
  }
  .col {
    min-height: 50vh;
    padding: 10px;
    border: 2px solid transparent;
    border-radius: var(--radius);
    background: #ebebe6;
  }
  .col.over {
    border-color: var(--accent);
  }
  h3 {
    display: flex;
    justify-content: space-between;
    margin: 0 0 8px;
    font-family: var(--font-display);
    font-size: 14px;
  }
  .k {
    display: flex;
    flex-direction: column;
    width: 100%;
    margin-bottom: 8px;
    padding: 10px;
    border: 1px solid var(--border);
    border-left: 4px solid var(--c, var(--border));
    border-radius: var(--radius);
    background: var(--surface);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .k .t {
    font-weight: 600;
  }
  .k .s {
    color: var(--muted);
    font-size: 13px;
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;
  }
  .archived {
    margin-top: 16px;
  }
  .archive-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 0 10px;
  }
  @media (max-width: 700px) {
    .tabs {
      display: flex;
      flex-wrap: nowrap;
      overflow-x: auto;
    }
    .board {
      grid-template-columns: 1fr;
    }
    .col {
      display: none;
      min-height: 0;
    }
    .col.on {
      display: block;
    }
    .col h3 {
      display: none;
    }
  }
</style>
