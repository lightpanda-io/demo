// Keep in sync with golden/cookies.json. The runner sets cookies via a plain
// response (/cookies/set) and via a 302 (/cookies/redirect); the fixture pages
// then fetch/XHR /cookies/get, which echoes the request cookies as JSON into
// #result.
const page = new Page();
await page.goto("http://127.0.0.1:1234/cookies/set");
await page.goto("http://127.0.0.1:1234/cookies/redirect");

await page.goto("http://127.0.0.1:1234/cookies/fetch.html");
page.waitForScript("document.getElementById('result').textContent.trim().length > 0");
const viaFetch = page.extract({ cookies: "#result" }).cookies;

await page.goto("http://127.0.0.1:1234/cookies/xhr.html");
page.waitForScript("document.getElementById('result').textContent.trim().length > 0");
const viaXhr = page.extract({ cookies: "#result" }).cookies;

return { fetch: JSON.parse(viaFetch), xhr: JSON.parse(viaXhr) };
