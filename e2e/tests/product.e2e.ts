import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('shows the product the page loads from its JSON', async ({ app, screen }) => {
  await app.open();

  // Filled in by an XMLHttpRequest after the page loads.
  await expect(screen.getByRole('heading', 'Outdoor Odyssey Nomad Backpack 60 liters', { level: 1 })).toBeVisible();
  await expect(screen.getByRole('heading', '$244.99', { level: 4 })).toBeVisible();
  await expect(screen.getByRole('listitem').filter({ hasText: 'Large 60-liter capacity' })).toHaveCount(1);
});

test('lists the related products', async ({ app, screen }) => {
  await app.open();

  for (const name of ['Outdoor Odyssey Hiking Poles', 'Outdoor Odyssey Sleeping Bag', 'Outdoor Odyssey Water Bottle']) {
    await expect(screen.getByRole('heading', name, { level: 4 })).toBeVisible();
  }
});

test('shows the reviews the page fetches', async ({ app, screen }) => {
  await app.open();

  // Filled in by fetch(): three reviews, each headed by its first five words.
  for (const heading of ['I recently took the Nomad...', "As an avid hiker, I've...", 'I purchased the Nomad Backpack...']) {
    await expect(screen.getByRole('heading', heading, { level: 4 })).toBeVisible();
  }
});

test('sets the quantity', async ({ app, screen }) => {
  await app.open();

  const quantity = screen.getByRole('spinbutton');
  await expect(quantity).toHaveValue('1');
  await quantity.fill('2');
  await expect(quantity).toHaveValue('2');
});

test('a thumbnail becomes the main photo', async ({ app, browser }) => {
  await app.open();

  const photo = browser.locator('#product-image');
  await expect(photo).toHaveAttribute('src', 'images/nomad_000.jpg');
  await browser.locator('#small-product-image-2').tap();
  // The click handler copies the thumbnail's resolved, absolute URL.
  await expect(photo).toHaveAttribute('src', /\/images\/nomad_001\.jpg$/);
});
