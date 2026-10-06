import { connect } from "puppeteer-core";

const URL = "https://amazon.com";
const bookName = "ces jours qui disparaissent";

const browser = await connect({
  browserWSEndpoint: "ws://127.0.0.1:9222/",
});

const page = await browser.newPage();

// Amazon serves a bot interstitial (and a 503 on search) to the exact default
// "Lightpanda/1.0" user agent. Keep the browser's own UA and append a suffix
// identifying this script. Read it from navigator: Browser.getVersion reports a
// Chrome-compatible UA, and Lightpanda ignores overrides containing "Mozilla".
const userAgent = await page.evaluate(() => navigator.userAgent);
await page.setUserAgent(`${userAgent} lightpanda-demo`);
await page.goto(URL, { waitUntil: "domcontentloaded" });

// Amazon's bot protection: either a "Continue shopping" interstitial, an image
// CAPTCHA (form posting to /errors/validateCaptcha), or a 503 "Sorry! Something
// went wrong!" page instead of the search results.
const isBlocked = () =>
  page.evaluate(
    () =>
      document.querySelector('form[action*="validateCaptcha"]') !== null ||
      document.title.includes("Something went wrong"),
  );

const skip = (reason) => {
  // Not a Lightpanda failure: Amazon blocked the request with its bot
  // protection, so no results were ever rendered.
  console.log(`SKIP: Amazon served its bot protection (${reason}), no results to check`);
  // integration/main.go detects the special error code
  process.exit(103);
};

// Type in search input.
for (let attempt = 0; ; attempt++) {
  try {
    await page.type("#twotabsearchtextbox", bookName, {
      delay: 218,
    });
    break;
  } catch {
    // Click to continue page appeared. Give up when it keeps coming back or
    // is a real CAPTCHA without the button.
    const clicked =
      attempt < 3 &&
      (await page.evaluate(() => {
        const button = document.querySelector("button.a-button-text");
        button?.click();
        return button !== null;
      }));
    if (!clicked) {
      await page.close();
      await browser.disconnect();
      skip("captcha on the home page");
    }

    await page.waitForNavigation({ waitUntil: "domcontentloaded" });
  }
}

const [response] = await Promise.all([
  page.waitForNavigation(),
  page.keyboard.press("Enter"),
]);

if (response?.status() === 503 || (await isBlocked())) {
  await page.close();
  await browser.disconnect();
  skip(`search returned ${response?.status()}`);
}

const title = await page.evaluate(() =>
  document
    .querySelector("div[data-cy=title-recipe] h2 span")
    .innerText.toLowerCase(),
);

console.assert(title.includes(bookName));

await page.close();
await browser.disconnect();
