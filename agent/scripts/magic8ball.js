// Keep in sync with golden/magic8ball.json. The answer travels
// window -> iframe (postMessage) -> Web Worker -> back. The worker picks
// its answer with Math.random(), so the script normalizes it to a membership
// check instead of pinning the text. Waits are expression-based, not
// networkidle: the page references an external Wikimedia image.
const page = new Page();
await page.goto("http://127.0.0.1:1234/magic8ball/index.html");

page.fill("#question", "Will this replay deterministically?");
page.click("#ask-form button[type=submit]");
page.waitForScript(
  "!['ask me anything', '...'].includes(document.getElementById('answer').textContent)"
);

const known = page.evaluate(`[
  'It is certain.', 'Without a doubt.', 'Most likely.', 'Outlook good.',
  'Yes, definitely.', 'Signs point to yes.', 'Reply hazy, try again.',
  'Ask again later.', 'Cannot predict now.', "Don't count on it.",
  'My reply is no.', 'Very doubtful.', 'Outlook not so good.',
  'Concentrate and ask again.', 'Absolutely not.', 'The stars say yes.'
].includes(document.getElementById('answer').textContent)`);

const oracle = page.evaluate(
  "document.querySelector('#child').contentDocument.getElementById('state').textContent.startsWith('the spirits whisper: ')"
);

// evaluate returns strings; normalize so the golden pins real booleans.
return { answered: known === "true", oracle: oracle === "true" };
