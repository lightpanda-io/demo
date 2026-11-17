# e2e with Lightpanda

Five locator tests and two agent tests on Campfire Commerce, a demo store
page that loads its product with `XMLHttpRequest` and its reviews with
`fetch()`. The tests run in [Lightpanda](https://lightpanda.io), the
open-source headless browser, on your machine, and on Lightpanda Cloud when
you have a token.

## Run

Use Node 22.22.3+ or 24.8+, and install Lightpanda:

```bash
brew install lightpanda-io/browser/lightpanda
```

On Linux, follow the [installation guide](https://lightpanda.io/docs/run-locally/installation/one-liner).
Then clone this repository and run the tests from this folder:

```bash
git clone https://github.com/lightpanda-io/demo
cd demo/e2e
npm install
npm run test:e2e
```

No Chrome is needed. Results are in `.e2e/report.json`.

## What Lightpanda changes

[e2e.config.ts](https://github.com/lightpanda-io/demo/blob/main/e2e/e2e.config.ts) sets the browser to `lightpanda()` from
[`@e2e-dev/lightpanda`](https://e2e.com/docs/integrations/lightpanda).
Each worker starts its own `lightpanda serve` on a free port and stops it
when the run ends. `loadResources: ['stylesheet']` makes the server fetch
linked stylesheets, so a node that a stylesheet hides is hidden to a query.

The tests target `https://demo-browser.lightpanda.io/campfire-commerce/`,
which Lightpanda's own CI also tests. Set `APP_URL` to run them against
another copy of the page.

## Lightpanda CDP commands

Lightpanda adds its own CDP commands, the `LP` domain, such as `LP.dump`
for the page as markdown or `LP.getInteractiveElements` for what a user can
act on. e2e tests don't open CDP sessions; from Playwright, send them on the
page's session:

```js
const client = await context.newCDPSession(page);

const { content } = await client.send('LP.dump', { format: 'markdown' });
const { elements } = await client.send('LP.getInteractiveElements');
```

See the [LP domain reference](https://lightpanda.io/docs/reference/cdp-lp-domain)
and [Playwright with Lightpanda](https://lightpanda.io/docs/usage/cdp/playwright).

## Lightpanda Cloud

Set a [Lightpanda Cloud](https://lightpanda.io) token to add a
`lightpanda-cloud` target, which connects to a hosted browser over CDP:

```bash
LPD_TOKEN="your-token" npm run test:e2e -- --target lightpanda-cloud
```

## Agent tests

Set a [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) key:

```bash
AI_GATEWAY_API_KEY="your-key" npm run test:e2e
```

Without the key, the agent tests skip. The default model needs AI Gateway
credits; on a free Vercel account, set a free model such as
`nvidia/nemotron-3.5-lightning-free` in `e2e.config.ts`.

Last checked with e2e 0.23.1, @e2e-dev/web 0.16.0, @e2e-dev/lightpanda 0.0.2,
Lightpanda 1.0.4, and Node 22.
