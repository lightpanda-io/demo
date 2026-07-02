// Keep in sync with golden/campfire.json.
const page = new Page();
await page.goto("http://127.0.0.1:1234/campfire-commerce/");
// The page renders from two separate fetches (product.json, reviews.json);
// extracting before both complete reads the empty shell.
page.waitForSelector("#product-related .col-3");
page.waitForSelector("#product-reviews .col-3");

return page.extract({
  name: "#product-name",
  price: "#product-price",
  features: ["#product-features li"],
  related: [{
    selector: "#product-related .col-3",
    fields: {
      name: "h4",
      price: "p"
    }
  }],
  reviews: [{
    selector: "#product-reviews .col-3",
    fields: {
      title: "h4"
    }
  }]
});
