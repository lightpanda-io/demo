import "dotenv/config";
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v3";

const browserAddress = process.env.BROWSER_ADDRESS ? process.env.BROWSER_ADDRESS : 'ws://127.0.0.1:9222';
const url = process.env.URL ? process.env.URL : 'http://127.0.0.1:1234/campfire-commerce';

const stagehand = new Stagehand({
  env: "LOCAL",
  localBrowserLaunchOptions: {
    cdpUrl: browserAddress
  },
 // You need an ANTHROPIC_API_KEY env var.
  model: "anthropic/claude-haiku-4-5",
  verbose: 0,
});

await stagehand.init();
// In the official documentation, Stagehand uses the default existing page.
// But Lightpanda requires an explicit page's creation instead.
const page = await stagehand.context.newPage();

await page.goto(url, {waitUntil: "networkidle"});

const price = await stagehand.extract("find the product's price", z.string());

await stagehand.close()

if (price !== "$244.99") {
  console.log("price extracted", price);
  throw new Error("prive value is not as expected");
}
