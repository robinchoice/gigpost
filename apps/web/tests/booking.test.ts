import { expect, type Page, test } from '@playwright/test';
import postgres from 'postgres';
import { logIn } from './login';

const sql = postgres(process.env.DATABASE_URL!, { connection: { timezone: 'UTC' }, onnotice: () => {} });
test.afterAll(() => sql.end());

// Console errors fail the test, CSP violations included
let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
});
test.afterEach(() => expect(errors).toEqual([]));

// What an agent adds through the API, with the session of the page
async function addDraft(page: Page) {
  const name = `Venue ${crypto.randomUUID().slice(0, 8)}`;
  const post = async (path: string, data: object) => {
    const res = await page.request.post(`/api/v1/booking${path}`, { data });
    expect(res.ok()).toBe(true);
    return res.json();
  };
  const { artist } = await post('/artists', { name: `Artist ${crypto.randomUUID().slice(0, 8)}` });
  const { venue } = await post('/venues', { name, city: 'Freiburg', email: 'booking@venue.example', contact: 'Jana' });
  const { draftId, dealId } = await post('/drafts', {
    venueId: venue.id,
    artistId: artist.id,
    why: 'Spielt Indie aus dem Südwesten',
    subject: `Anfrage ${name}`,
    body: 'Hallo Jana,\n\nhabt ihr im Frühjahr Platz?\n\nViele Grüße',
  });
  return { name, draftId, dealId };
}

// The API runs with ADMIN_EMAILS=e2e-admin@example.com, see playwright.config.ts
test('the admin goes through a draft, sends it to a test address and the card moves on', async ({ page }) => {
  await logIn(page, 'e2e-admin@example.com');
  const { name, draftId, dealId } = await addDraft(page);

  await page.goto(`/drafts?draft=${draftId}`);
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByText('Spielt Indie aus dem Südwesten')).toBeVisible();
  await expect(page.getByLabel('An')).toHaveValue('Jana <booking@venue.example>');
  // Tests never write to a venue
  await page.getByLabel('An').fill('admin@pleasance.org');
  await page.getByLabel('Text').press('Control+Enter');
  await expect(page.getByText('Gesendet an admin@pleasance.org')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Fertig' })).toBeVisible();
  const [sent] = await sql`select kind, text from deal_events where deal_id = ${dealId}`;
  expect(sent).toMatchObject({ kind: 'request', text: `Anfrage ${name}` });

  await page.getByRole('link', { name: 'Locations' }).click();
  const card = page.getByRole('region', { name: 'Angefragt' }).getByRole('button', { name: new RegExp(name) });
  await expect(card).toContainText('heute gesendet');
  await card.click();

  const drawer = page.getByRole('dialog', { name });
  await drawer.getByRole('button', { name: 'Antwort erhalten' }).click();
  await drawer.getByLabel('Was haben sie geantwortet? (optional)').fill('Klingt gut, April?');
  await drawer.getByRole('button', { name: 'Antwort erhalten' }).click();
  await expect(drawer.getByText('Antwort: Klingt gut, April?')).toBeVisible();
  await expect(drawer.getByLabel('Stand')).toHaveValue('talking');
  await drawer.getByRole('button', { name: 'Schließen' }).first().click();
  await expect(
    page.getByRole('region', { name: 'Im Gespräch' }).getByRole('button', { name: new RegExp(name) }),
  ).toBeVisible();
});

test('agents prepare drafts, only an admin may send them', async ({ page }) => {
  await logIn(page);
  const { draftId } = await addDraft(page);
  await page.goto(`/drafts?draft=${draftId}`);
  await expect(page.getByText('Senden darf nur ein Admin.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Senden' })).toBeDisabled();
  const res = await page.request.post(`/api/v1/booking/drafts/${draftId}/send`, {
    data: { to: 'admin@pleasance.org', subject: 'x', body: 'x' },
  });
  expect(res.status()).toBe(403);

  await page.getByRole('button', { name: 'Verwerfen' }).click();
  await expect(page.getByText('Verworfen')).toBeVisible();
});
