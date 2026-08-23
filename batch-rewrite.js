/**
 * batch-rewrite.js
 *
 * Crawls a novel chapter-by-chapter starting from a given chapter URL,
 * using a site-specific parser (see parsers/) to extract content, runs it
 * through Gemini for de-slopping (see rewrite.js), and saves each chapter as
 * markdown under:
 *
 *   output/<site-id>/<novel-slug>/chapter-<n>.md
 *
 * To support a new site, add a parser module in parsers/ — see the comment
 * at the top of parsers/index.js.
 *
 * Usage:
 *   node batch-rewrite.js <start-chapter-url>
 *
 * Re-running is safe: it skips any chapter that already has an output file,
 * so you can stop (Ctrl+C) and resume anytime, including on a different
 * novel/site than last time — it re-detects the parser and output folder
 * from whatever URL you pass in.
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { sleep, fetchWithRetry } = require('./lib/http');
const { addChapterToIndex } = require('./lib/outputIndex');
const { findParser } = require('./parsers');
const { rewriteChapter } = require('./rewrite');

// ---------------------- CONFIG ----------------------
const START_URL = process.argv[2];
const MAX_CHAPTERS = 500;              // safety cap, stops even if "next" links loop
const OUTPUT_BASE_DIR = './output';
const DELAY_BETWEEN_PAGES_MS = 1500;   // be polite to the site
const PAGE_TIMEOUT_MS = 60000;
const PAGE_RETRIES = 6;
// ------------------------------------------------------

if (!START_URL) {
  console.error('No start URL given.');
  console.error('Usage: node batch-rewrite.js <start-chapter-url>');
  process.exit(1);
}

async function fetchChapterPage(url) {
  try {
    const res = await fetchWithRetry(
      url,
      { headers: { 'User-Agent': 'Mozilla/5.0 (personal reading script)' } },
      { retries: PAGE_RETRIES, timeoutMs: PAGE_TIMEOUT_MS }
    );
    const html = await res.text();
    return cheerio.load(html);
  } catch (err) {
    // Distinguish "this chapter page doesn't exist" from any other 404 that
    // might occur elsewhere (e.g. a mistyped Gemini model name) — only this
    // specific case should be read as "caught up to the latest chapter."
    if (err.status === 404) err.isChapterNotFound = true;
    throw err;
  }
}

async function processChapter(url, parser, novelSlug, outputDir) {
  const chapterSlug = parser.getChapterSlug(url);
  const outPath = path.join(outputDir, `chapter-${chapterSlug}.md`);

  if (fs.existsSync(outPath)) {
    console.log(`skip chapter-${chapterSlug} (already done)`);
    // Backfill the index in case this chapter was saved before index.json
    // existed (or the index got out of sync some other way) — cheap and
    // idempotent, so it's safe to do on every skip.
    addChapterToIndex(OUTPUT_BASE_DIR, parser.id, novelSlug, chapterSlug);
    // still need to know the next URL to keep the crawl going
    const $ = await fetchChapterPage(url);
    return parser.extractChapter($, url).nextUrl;
  }

  console.log(`fetching chapter-${chapterSlug} ...`);
  const $ = await fetchChapterPage(url);
  const { title, paragraphs, nextUrl } = parser.extractChapter($, url);

  if (paragraphs.length === 0) {
    console.warn(`  no paragraphs found for chapter-${chapterSlug}, skipping rewrite`);
    return nextUrl;
  }

  const rewritten = await rewriteChapter(paragraphs);

  const fileContent = `# ${title}\n\n${rewritten}\n`;
  fs.writeFileSync(outPath, fileContent, 'utf8');
  addChapterToIndex(OUTPUT_BASE_DIR, parser.id, novelSlug, chapterSlug);
  console.log(`  saved -> ${outPath}`);

  return nextUrl;
}

async function main() {
  const parser = findParser(START_URL);
  if (!parser) {
    console.error(`No parser available for: ${START_URL}`);
    console.error('Add one in parsers/ and register it in parsers/index.js — see README.md.');
    process.exit(1);
  }

  const novelSlug = parser.getNovelSlug(START_URL);
  const outputDir = path.join(OUTPUT_BASE_DIR, parser.id, novelSlug);
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`Site: ${parser.id}  |  Novel: ${novelSlug}`);
  console.log(`Output: ${outputDir}\n`);

  let url = START_URL;
  let count = 0;
  let consecutiveChapterFailures = 0;

  while (url && count < MAX_CHAPTERS) {
    try {
      url = await processChapter(url, parser, novelSlug, outputDir);
      consecutiveChapterFailures = 0;
    } catch (err) {
      // A 404 on the chapter page itself (not the LLM call) means the site
      // simply doesn't have this chapter — you've caught up to the latest
      // one posted. That's success, not failure: stop cleanly.
      if (err.isChapterNotFound) {
        console.log(`\n${url} doesn't exist yet — you're caught up to the latest chapter.`);
        break;
      }

      consecutiveChapterFailures++;
      console.error(`FAILED on ${url}: ${err.message}`);

      if (consecutiveChapterFailures >= 10) {
        console.error(
          '10 chapters in a row failed even after cooldowns — stopping for real. ' +
          'Something other than transient overload is likely wrong. Re-run to resume.'
        );
        process.exit(1);
      }

      // Gemini overload (503s) can last minutes to hours, not just seconds.
      // This runs unattended overnight, so wait it out and retry the SAME
      // chapter rather than crashing — much better than needing a human to
      // notice and restart it.
      const cooldownMin = 5;
      console.error(`Cooling down ${cooldownMin} min before retrying this same chapter...`);
      await sleep(cooldownMin * 60 * 1000);
      continue; // retry same url, don't advance, don't increment count
    }
    count++;
    await sleep(DELAY_BETWEEN_PAGES_MS);
  }

  console.log(`\nDone. Processed ${count} chapters into ${outputDir}/`);
}

main();