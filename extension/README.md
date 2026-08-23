# Novel De-slopper (browser extension)

Swaps a chapter's on-page text for the pre-rewritten version from your
local `output/` folder, if one exists. Does nothing otherwise — no live
API calls, no rewriting in the browser. It's purely "have I already
batch-processed this exact chapter? If so, show that instead."

## Load it (unpacked)

1. `chrome://extensions`
2. Enable "Developer mode" (top right)
3. "Load unpacked" → select this `extension/` folder
4. On the extension's card, click "Details" → enable **"Allow access to
   file URLs"**. Without this, it can't read your local `output/` folder
   at all.

## Configure

Click the extension's icon → paste the `file://` path to your `output`
folder (the one with `index.json` in it, produced by `batch-rewrite.js`)
→ Save.

Example: `file:///C:/Users/alany/Documents/Projects/Unslopper/output`

## How it decides whether to do anything

On a matched page (currently just novelphoenix.com — see below to add
more):

1. Is there an `index.json` entry for this site at all? If not, do
   nothing.
2. Does this novel have any rewritten chapters? If not, do nothing.
3. Is *this specific* chapter number in the list? If not, do nothing.
4. If yes to all three: fetch `chapter-<n>.md`, and if the number of
   paragraphs in the rewrite matches the number of real paragraphs found
   on the page, swap each one's text in place. If the counts don't match
   (site changed its markup, or something odd happened during batch
   processing), it logs a warning to the console and leaves the page
   untouched rather than risk mangling it.

A small "De-slopped ✓" badge appears briefly in the corner when a swap
happens, just so you know it worked. Safe to delete if you'd rather it be
silent — it's clearly marked in `content.js`.

## Adding a new site

1. Copy `parsers/novelphoenix.js` to `parsers/your-site.js` and adjust:
   - `matches()` — the hostname to match
   - `getNovelSlug()` / `getChapterSlug()` — pull these out of that site's
     URL structure
   - `getParagraphElements()` — the DOM selectors for that site's chapter
     content, using the *same* skip-empty/skip-placeholder filtering as
     the Node-side parser for that site, so paragraph counts line up
2. In `manifest.json`, add the new filename to `content_scripts[0].js`
   (before `content.js`) and add the site's URL pattern to
   `content_scripts[0].matches`.
3. Reload the extension at `chrome://extensions`.

This mirrors adding a parser on the Node side — same idea, DOM-based
instead of cheerio-based, since a live page and a fetched HTML string
need slightly different tools to query but the same logic otherwise.

## Why the background script does the file reading

Content scripts run in the context of the page they're injected into.
Fetching `file://` URLs needs the extension-wide "Allow access to file
URLs" permission, which is more reliably available from the background
service worker than from a content script running on an arbitrary
https:// page. `content.js` asks `background.js` for the chapter via
`chrome.runtime.sendMessage` rather than fetching the file itself.
