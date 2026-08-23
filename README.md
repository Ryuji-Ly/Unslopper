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
```

Saves to `output/<site-id>/<novel-slug>/chapter-<n>.md`. Safe to stop
(Ctrl+C) and re-run anytime — skips chapters already done, and stops
cleanly once it hits a chapter that doesn't exist yet.

## Adding a site

No parser for a URL's site → the script exits and says so. To add one,
copy `parsers/novelphoenix.js` to `parsers/your-site.js`, adjust the
selectors in `extractChapter()` and the slug functions to match that
site, then register it in `parsers/index.js`.

## Layout

```txt
batch-rewrite.js   orchestrator: crawl, parse, rewrite, save
rewrite.js          Gemini de-slopping logic
lib/http.js         shared fetch-with-retry
parsers/            one file per site
output/             generated chapters (gitignored)
```
