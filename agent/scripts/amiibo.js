// Keep in sync with golden/amiibo.json. Each amiibo page is a JS-rendered
// shell (load.js fills it from JSON), hence the networkidle waits.
const page = new Page();
await page.goto("http://127.0.0.1:1234/amiibo/index.html");
page.waitForState("networkidle");

const { alt, ...start } = page.extract({
  name: "#name",
  game: "#game",
  serie: "#serie",
  alt: [{
    selector: "#alt li a",
    limit: 3,
    fields: {
      href: { selector: "", attr: "href" }
    }
  }]
});

const related = [];
for (const link of alt) {
  // extract resolves href attributes to absolute URLs.
  await page.goto(link.href);
  page.waitForState("networkidle");
  const character = page.extract({
    name: "#name",
    game: "#game",
    serie: "#serie"
  });
  related.push(character);
}

return { start, related };
