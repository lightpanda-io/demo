import { connect } from "puppeteer-core";

const browser = await connect({
  browserWSEndpoint: "ws://127.0.0.1:9222/",
});

const page = await browser.newPage();
await page.goto("https://www.amazon.pl/dp/B0BHQPJJ21", {
  waitUntil: "domcontentloaded",
});

await new Promise((resolve) => setTimeout(resolve, 5_000));

const urlBefore = page.url();

while (true) {
  try {
    await page.evaluate(() => {
      const input = document.querySelector("input#buy-now-button");
      input.click();
    });
    break;
  } catch {
    // Likely click to continue page appeared.
    await page.evaluate(() => {
      const button = document.querySelector("button.a-button-text");
      button.click();
    });

    await page.waitForNavigation({ waitUntil: "domcontentloaded" });
  }
}

await new Promise((resolve) => setTimeout(resolve, 5_000));

console.assert(urlBefore != page.url());

await page.close();
await browser.disconnect();
