// Keep in sync with golden/checked.json. The fixture records the event order
// on #promo into the submitted `events` field, pinning click -> input -> change.
const page = new Page();
await page.goto("http://127.0.0.1:1234/form/checkbox.html");
page.setChecked("#news", false);
page.setChecked("#promo", true);
page.setChecked("#pro", true);
page.click("#submit");
page.waitForSelector("#method");

return page.extract({
  method: "#method",
  query: "#query"
});
