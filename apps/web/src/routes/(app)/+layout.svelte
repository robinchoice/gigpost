<script lang="ts">
  import { APP_NAME } from '@app/shared';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { auth, checkAuth, logout } from '$lib/auth.svelte';
  import { booking, drafts, loadBooking } from '$lib/booking.svelte';
  import DealDrawer from '$lib/components/DealDrawer.svelte';
  import Feedback from '$lib/components/Feedback.svelte';
  import { openFeedback } from '$lib/feedback.svelte';
  import { t } from '$lib/i18n';
  import '$lib/booking.css';

  let { children } = $props();
  let ready = $state(false);
  let menu = $state<HTMLDetailsElement>();

  onMount(async () => {
    await checkAuth();
    if (auth.user) {
      ready = true;
      await loadBooking();
      return;
    }
    // Come back to the requested page after logging in
    goto(`/login?next=${encodeURIComponent(page.url.pathname + page.url.search)}`, { replaceState: true });
  });

  async function handleLogout() {
    await logout();
    goto('/');
  }

  const nav = $derived([
    { href: '/dashboard', label: t().navToday },
    { href: '/drafts', label: t().navDrafts, count: booking.data ? drafts(booking.data).length : null },
    { href: '/locations', label: t().navLocations },
  ]);

  // Close the menu after picking an item
  const closeMenu = () => menu?.removeAttribute('open');
</script>

{#if ready && auth.user}
  <header>
    <a href="/dashboard" class="brand">{APP_NAME}</a>
    <nav>
      {#each nav as item (item.href)}
        <a href={item.href} class:on={page.url.pathname.startsWith(item.href)}>
          {item.label}
          {#if item.count}<span class="count">{item.count}</span>{/if}
        </a>
      {/each}
    </nav>
    <span class="user">{auth.user.email}</span>
    <details class="menu" bind:this={menu}>
      <summary>{t().menu}</summary>
      <div class="items">
        <a href="/settings" onclick={closeMenu}>{t().settings}</a>
        {#if auth.user.admin}
          <a href="/admin/updates" onclick={closeMenu}>{t().updates}</a>
          <a href="/invite" onclick={closeMenu}>{t().inviteTester}</a>
        {/if}
        <button
          type="button"
          onclick={() => {
            closeMenu();
            openFeedback('idea');
          }}>{t().giveFeedback}</button
        >
        <button type="button" onclick={handleLogout}>{t().logOut}</button>
      </div>
    </details>
  </header>
  <main class:wide={page.url.pathname.startsWith('/locations')}>
    {@render children()}
  </main>
  <DealDrawer />
  <Feedback />
{/if}

<style>
  header {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    align-items: center;
    padding: 0.6rem 1.25rem;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .brand {
    font-family: var(--font-display);
    font-size: 1.3rem;
    font-weight: 750;
    font-stretch: 80%;
    text-decoration: none;
  }
  nav {
    display: flex;
    gap: 0.25rem;
  }
  nav a {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.65rem;
    border-radius: var(--radius);
    color: var(--muted);
    text-decoration: none;
  }
  nav a.on {
    background: var(--bg);
    color: var(--text);
    font-weight: 600;
    box-shadow: inset 0 -2px 0 var(--accent);
  }
  .count {
    padding: 0 0.45rem;
    border-radius: 99px;
    background: var(--needs-bg);
    color: #17171a;
    font-size: 0.75rem;
    font-weight: 700;
  }
  .user {
    margin-left: auto;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .menu {
    position: relative;
  }
  .menu summary {
    list-style: none;
    padding: 0.35rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
  }
  .menu summary::-webkit-details-marker {
    display: none;
  }
  .items {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 40;
    display: flex;
    flex-direction: column;
    min-width: 190px;
    padding: 0.35rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: 0 8px 30px rgb(0 0 0 / 0.08);
  }
  .items a,
  .items button {
    padding: 0.5rem 0.65rem;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
  }
  .items a:hover,
  .items button:hover {
    background: var(--bg);
  }
  @media (max-width: 700px) {
    header {
      padding: 0.6rem 0.85rem;
    }
    .user {
      display: none;
    }
    .menu {
      margin-left: auto;
    }
    nav {
      order: 3;
      width: 100%;
      overflow-x: auto;
    }
  }
  main {
    max-width: 980px;
    margin: 0 auto;
    padding: 1.5rem 1.25rem 3rem;
  }
  main.wide {
    max-width: 1240px;
  }
  @media (max-width: 700px) {
    main {
      padding: 1rem 0.75rem 3rem;
    }
  }
</style>
