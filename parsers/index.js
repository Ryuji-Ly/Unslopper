/**
 * parsers/index.js — registry of site-specific parsers.
 *
 * To support a new site:
 *   1. Copy parsers/novelphoenix.js to parsers/your-site.js and adjust the
 *      selectors in extractChapter() to match that site's markup, plus
 *      getNovelSlug/getChapterSlug to match its URL structure.
 *   2. Import it below and add it to the PARSERS array.
 * That's it — batch-rewrite.js will pick it up automatically based on
 * whichever parser's matches(url) returns true for the URL you pass in.
 */

const novelphoenix = require('./novelphoenix');
const novelping = require('./novelping');

const PARSERS = [novelphoenix, novelping];

function findParser(url) {
  return PARSERS.find((p) => p.matches(url)) || null;
}

module.exports = { PARSERS, findParser };