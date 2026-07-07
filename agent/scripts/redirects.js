// Keep in sync with golden/redirects.json. index1 -> index4 is a three-hop
// script-driven redirect chain (location.assign, document.location =,
// top.location =); the replay must settle on the final document.
const page = new Page();
await page.goto("http://127.0.0.1:1234/location_write/index1.html");
page.waitForScript(
  "document.getElementById('page') && document.getElementById('page').textContent === '4'"
);

return {
  page: page.extract({ page: "#page" }).page,
  path: page.evaluate("location.pathname")
};
