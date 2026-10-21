import { expect, test, type Page } from '@playwright/test';

// Seeded guest and the local OTP test-mode code (OTP_TEST_MODE=true in development only).
const GUEST_PHONE = '9000000020';
const TEST_CODE = '123456';

async function signIn(page: Page, phone: string, returnTo: string) {
  await page.goto(`/auth?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByLabel('Mobile number').fill(phone);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('One-time code').fill(TEST_CODE);
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'));
}

function isoDaysAhead(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

test('public stay page never shows the exact address', async ({ page, request }) => {
  const list = await (await request.get('/api/v1/public/listings?q=cabin')).json();
  const id = list.items[0].id as string;
  await page.goto(`/stays/${id}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Pine Hill Estate');
});

test('guest books an instant stay, pays through the mock gateway and then sees the address (§18.2 #3)', async ({ page, request }) => {
  const list = await (await request.get('/api/v1/public/listings?q=cabin')).json();
  const id = list.items[0].id as string;
  // A random far-future window keeps reruns from colliding with earlier bookings.
  const start = 120 + Math.floor(Math.random() * 120);
  const checkIn = isoDaysAhead(start);
  const checkOut = isoDaysAhead(start + 2);

  await signIn(page, GUEST_PHONE, `/book/${id}?checkIn=${checkIn}&checkOut=${checkOut}&guests=2`);
  await expect(page.getByRole('heading', { name: 'Confirm and pay' })).toBeVisible();
  await page.getByRole('button', { name: /Confirm and pay/ }).click();

  await page.waitForURL(/\/pay\/mock\//);
  await expect(page.getByText('Development payment page')).toBeVisible();
  await page.getByRole('button', { name: /^Pay ₹/ }).click();

  await page.waitForURL(/\/trips\/.+payment=succeeded/);
  await expect(page.getByText("You're booked!")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Pine Hill Estate')).toBeVisible();
});

test('signed-out visitors are sent to sign-in for private areas', async ({ page }) => {
  await page.goto('/owner');
  await expect(page).toHaveURL(/\/auth\?returnTo=%2Fowner/);
});
