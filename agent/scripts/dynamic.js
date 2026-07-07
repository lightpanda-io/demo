// Keep in sync with golden/dynamic.json. The appended <script> must load and
// run before extraction; frames/index.html reads the child frame's DOM onload.
const page = new Page();
await page.goto("http://127.0.0.1:1234/dynamic_scripts/index.html");
page.waitForScript("document.getElementById('product').textContent.length > 0");
const product = page.extract({ product: "#product" }).product;

await page.goto("http://127.0.0.1:1234/frames/index.html");
page.waitForScript("typeof window.frame1_content === 'string'");
const frame = page.evaluate("window.frame1_content");

return { product, frame };
