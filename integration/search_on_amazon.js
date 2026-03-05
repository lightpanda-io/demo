import { connect } from "puppeteer-core";

const URL = "https://amazon.com";
const bookName = "ces jours qui disparaissent";

const browser = await connect({
  browserWSEndpoint: "ws://127.0.0.1:9222/",
});

const page = await browser.newPage();
await page.goto(URL, { waitUntil: "domcontentloaded" });

// Type in search input.
while (true) {
  try {
    await page.type("#twotabsearchtextbox", bookName, {
      delay: 218,
    });
    break;
  } catch {
    // Click to continue page appeared.
    await page.evaluate(() => {
      const button = document.querySelector("button.a-button-text");
      button.click();
    });

    await page.waitForNavigation({ waitUntil: "domcontentloaded" });
  }
}

await page.keyboard.press("Enter");

await page.waitForNavigation();

const title = await page.evaluate(() =>
  document
    .querySelector("div[data-cy=title-recipe] h2 span")
    .innerText.toLowerCase(),
);

console.assert(title.includes(bookName));

await page.close();
await browser.disconnect();
