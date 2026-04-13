import { connect } from "puppeteer-core";

const browser = await connect({
  browserWSEndpoint: "ws://127.0.0.1:9222/",
});
const page = await browser.newPage();

await page.goto(
  "https://bsky.app/profile/lightpanda.bsky.social/post/3mj2gw7ozss2k",
  {
    waitUntil: "domcontentloaded",
  },
);

const { author, handle, text } = await page.evaluate(() => {
  // Currently, we get it wrapped in noscript tags; headless Chrome receives the same.
  const content = document.querySelector("noscript").innerHTML;
  const doc = new DOMParser().parseFromString(content, "text/html");

  const author = doc.querySelector("p#bsky_display_name").innerText;
  const handle = doc.querySelector("p#bsky_handle").innerText;
  const text = doc.querySelector("p#bsky_post_text").innerText;

  return { author, handle, text };
});

console.assert(author === "Lightpanda");
console.assert(handle === "lightpanda.bsky.social");
console.assert(text === "300k -> 600k passing wpt tests 🚀");

await page.close();
await browser.disconnect();
