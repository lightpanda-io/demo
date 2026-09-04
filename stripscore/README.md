# stripscore

Scores `lightpanda fetch --dump markdown --strip-mode ...` against
mozilla/readability's test corpus. A measuring instrument, not a test: it
gates nothing and is run by hand when a strip heuristic changes.

```
git clone --depth 1 https://github.com/mozilla/readability.git ../../readability
cd stripscore
go run . -bin ../../browser/zig-out/bin/lightpanda            # none vs clutter
go run . -bin ... -strip shell -strip clutter -show 20 -out /tmp/strip.json
go run . -bin ... -filter mozilla                             # one page or a family
```

## What it measures

Each page is fetched twice through `lightpanda fetch --dump markdown`:
`expected.html` (readability's own output, served as a page) and
`source.html` with the strip mode under test. Both sides therefore share one
text renderer. The two markdown dumps are reduced to word lists (link and
image URLs dropped, CJK split per character) and aligned difflib-style; a
chunk the aligner leaves unpaired still counts when it occurs verbatim on
the other side, which is what repeated paragraphs need.

- **recall**: share of expected words matched. Under-strip never lowers
  it; over-strip does. Interleaved junk costs nothing.
- **junk**: share of output words unmatched. The raw dump (`none`) is the
  ceiling; a strip mode earns its keep by lowering it without moving recall.
- **undone**: the page tripped the shell undo (`strip shell undone` in the
  log).
- **fallbk**: clutter selection found too little and fell back to the
  chrome-only tier (`strip clutter fallback`). Pages whose paragraphs sit
  directly under body land here by design: the whole page is the article.

Aggregates are the target. A single page is a diagnostic: expected.html is
readability's output including its mistakes, so a low recall on one page may
be readability being wrong, not us. Known corpus quirks:

- `engadget` dumps nothing: its head carries `html { display: none }`, an
  anti-flash rule its scripts remove. With scripts stripped the page stays
  hidden and a document-rooted walk honours that.
- `nytimes-5` is a section front; readability keeps only the highlights
  strip, so recall is low for every mode.
- `iab-1` is the one page the chrome tier loses recall on: the author bio
  sits in an `<aside>` and readability keeps it.

Baseline on 2026-09-07 (130 pages):

| mode    | recall | mean junk | median junk | fallbacks |
|---------|-------:|----------:|------------:|----------:|
| none    |  98.8% |     24.3% |       15.0% |         - |
| shell   |  98.8% |     17.4% |        7.4% |         - |
| clutter |  98.3% |      2.1% |        0.0% |        17 |

Clutter's remaining recall losses: yahoo-2 (a slideshow's captions),
hukumusume (link lists readability keeps), embedded-videos (readability
keeps known video iframes, clutter prunes every iframe).

To see why a page lost text, run it alone at debug level; every prune
names its rule and every attempt its candidate:

```
lightpanda fetch --log-level debug --dump markdown --strip-mode clutter URL 2>&1 | grep clutter
```

## Serving

Pages are served from an in-process HTTP server. `<script>` and preload
`<link>` tags are removed from `source.html` (`-run-js` keeps them):
readability's expected output comes from a script-free DOM, and it keeps
the corpus offline. Nothing else is loaded (`--load-resources` default).

## Negatives

`negatives/` holds hand-built pages mozilla's corpus lacks: a thread, a
listing, a consent wall, a link-heavy docs page and a hero page where all
the text sits in the shell. Their expected.html is what a strip mode must
keep, so recall is the number to watch there. Add a page as
`negatives/<name>/{source,expected}.html`.
