// Keep in sync with golden/form.json. The runner's /form/submit echoes the
// method, body, and query string back as HTML.
const page = new Page();

// Hidden h1 is included in the echoed query, disabled h2 excluded.
await page.goto("http://127.0.0.1:1234/form/get.html");
page.fill("#input", "panda");
page.fill("#ta", "hello");
page.selectOption("select[name='favorite drink']", "tea");
page.click("#submit");
page.waitForSelector("#method");
const get = page.extract({
  method: "#method",
  query: "#query"
});

// Submitter semantics: clicking s1 puts s1=go in the POST body, excludes s2.
await page.goto("http://127.0.0.1:1234/form/submit_button.html");
page.click("input[name=s1]");
page.waitForSelector("#method");
const post = page.extract({
  method: "#method",
  body: "#body",
  query: "#query"
});

return { get, post };
