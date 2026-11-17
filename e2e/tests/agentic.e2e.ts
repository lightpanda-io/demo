import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { z } from 'zod';

// Agent steps call the model in e2e.config.ts. Without a key these tests are skipped.
const skip = process.env.AI_GATEWAY_API_KEY ? false : 'set AI_GATEWAY_API_KEY to run agent tests';

test('the agent reads the price', { skip }, async ({ app, agent, screen }) => {
  await app.open();
  // The product arrives by XMLHttpRequest: wait for it before the model reads the screen.
  await expect(screen.getByRole('heading', 'Outdoor Odyssey Nomad Backpack 60 liters', { level: 1 })).toBeVisible();

  const product = await agent.extract('the product name and its price in dollars', {
    schema: z.object({ name: z.string(), price: z.number() }),
  });

  // Pair each agent step with a check that does not depend on the model.
  expect(product.price).toBe(244.99);
  await expect(screen.getByRole('heading', product.name, { level: 1 })).toBeVisible();
});

test('the agent judges the reviews', { skip }, async ({ app, agent, screen }) => {
  await app.open();

  // The reviews arrive by fetch(): wait for the last one, not the static "Reviews" heading.
  await expect(screen.getByRole('heading', 'I purchased the Nomad Backpack...', { level: 4 })).toBeVisible();
  await agent.assert('every review on the page recommends the Nomad Backpack');
});
