import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { lightpanda } from '@e2e-dev/lightpanda';
import { gateway } from 'ai';

// Campfire Commerce, a demo store that Lightpanda's own CI tests against.
const url = process.env.APP_URL ?? 'https://demo-browser.lightpanda.io/campfire-commerce/';
const token = process.env.LPD_TOKEN;

export default {
  // The Vercel AI Gateway serves the model and reads AI_GATEWAY_API_KEY.
  // Only tests/agentic.e2e.ts needs it; tests/product.e2e.ts runs without one.
  agents: {
    default: { model: gateway('openai/gpt-6-luna-fast') },
  },
  targets: [
    {
      name: 'lightpanda',
      // One local `lightpanda serve` per worker. Linked stylesheets decide
      // what is visible, so the server fetches them.
      engine: web({ browser: lightpanda({ loadResources: ['stylesheet'] }) }),
      app: { url },
    },
    // The same tests on Lightpanda Cloud, when LPD_TOKEN is set.
    ...(token === undefined
      ? []
      : [
          {
            name: 'lightpanda-cloud',
            engine: web({ connect: { cdpEndpoint: () => `wss://euwest.cloud.lightpanda.io/ws?token=${token}` } }),
            app: { url },
          },
        ]),
  ],
} satisfies E2EConfig;
