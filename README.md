# Novel de-slopper

Rewrites AI-slop web novel chapters into cleaner prose via the Gemini API
(free tier).

## Setup

```bash
npm install cheerio
echo 'export GEMINI_API_KEY=your-key-here' >> ~/.bashrc
source ~/.bashrc
```

Get a free key at <https://aistudio.google.com> → "Get API key".

## Run

```bash
node batch-rewrite.js <start-chapter-url>
node batch-rewrite.js <book-url> [chapter-number]   # sites with a chapter list
```

Supported sites: novelphoenix.com, novelping.com. On novelping, chapter
URLs include the chapter title, so the book-URL form is easier, e.g.
`node batch-rewrite.js https://novelping.com/book/<novel> 1` (defaults to
the first chapter if no number is given).

Saves to `output/<site-id>/<novel-slug>/chapter-<n>.md`. Safe to stop
(Ctrl+C) and re-run anytime — skips chapters already done, and stops
cleanly once it hits a chapter that doesn't exist yet.

## Checking quality

`lib/slopScan.js` counts AI-prose patterns (negative parallelism, triplets,
staccato fragments, dashes, AI vocabulary...), based on Wikipedia's
[Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing).
Each run logs a `slop score: before -> after pass 1 -> after pass 2` line,
and you can score saved chapters directly (`-v` lists flagged sentences):

```bash
node lib/slopScan.js -v output/novelphoenix.com/the-guardian-gods/chapter-505.md
```

It's a crude regex pointer, not a judge; use it to compare prompt changes,
then read the output.

## Adding a site

No parser for a URL's site → the script exits and says so. To add one,
copy `parsers/novelphoenix.js` to `parsers/your-site.js`, adjust the
selectors in `extractChapter()` and the slug functions to match that
site, then register it in `parsers/index.js`. If the site's chapter URLs can't be
guessed, also add `isIndexUrl`, `getChapterList` (and `getChapterListUrl`
if the list is loaded separately), like `parsers/novelping.js` does. For the
extension, add a matching file in `extension/parsers/` and a
`content_scripts` entry in `extension/manifest.json`.

## Layout

```txt
batch-rewrite.js   orchestrator: crawl, parse, rewrite, save
rewrite.js          Gemini de-slopping logic
lib/http.js         shared fetch-with-retry
lib/outputIndex.js  maintains output/index.json (a lookup table of what's done)
lib/slopScan.js     AI-prose pattern scanner (feeds pass 2, scores output)
parsers/            one file per site
output/             generated chapters + index.json (gitignored)
extension/          browser extension that reads output/ to swap already-
                    rewritten chapters in-page — see extension/README.md
```
