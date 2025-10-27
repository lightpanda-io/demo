import { connect } from "puppeteer-core";

const browser = await connect({ browserWSEndpoint: "ws://127.0.0.1:9222" });

const context = await browser.createBrowserContext();
const page = await context.newPage();

await page.goto("https://google.com", { waitUntil: "networkidle0" });

await page.type("input.lst", "lightpanda");
await Promise.all([
  page.waitForNavigation({ waitUntil: "networkidle0" }),
  page.keyboard.press("Enter"),
]);

const hasConsent = await page.evaluate(() => {
  return document.querySelectorAll('form[action="https://consent.google.com/save"] input[type="submit"]').length;
});
if (hasConsent) {
  console.log("form consent detected");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click('form[action="https://consent.google.com/save"] input[type="submit"]'),
  ]);
}


const html = await page.content();
console.log(html);

await page.close();
await context.close();
await browser.disconnect();

