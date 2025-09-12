import { connect } from "puppeteer-core";
import { writeFileSync } from "node:fs";

const browser = await connect({ browserWSEndpoint: "ws://127.0.0.1:9222" });

const context = await browser.createBrowserContext();
const page = await context.newPage();

await page.goto("https://google.com", { waitUntil: "networkidle0" });

await page.type("input.lst", "lightpanda");
await Promise.all([
  page.waitForNavigation({ waitUntil: "networkidle0" }),
  page.keyboard.press("Enter"),
]);
