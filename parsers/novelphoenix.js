/**
 * parsers/novelphoenix.js — extraction logic specific to novelphoenix.com's
 * chapter page markup.
 *
 * Kept dependency-light on purpose: only DOM queries plus text/attribute
 * reads, no cheerio-specific tricks beyond basic selection. That's so this
 * same extraction logic can be ported into a browser content script later
 * with minimal changes (querySelector/textContent instead of cheerio's
 * $()/text(), same structure otherwise).
 */

function hostnameOf(url) {
  return new URL(url).hostname.replace(/^www\./, '');
}

module.exports = {
  id: 'novelphoenix.com',
  name: 'NovelPhoenix',

  matches(url) {
    return hostnameOf(url) === 'novelphoenix.com';
  },

  // https://novelphoenix.com/novel/the-guardian-gods/chapter-527 -> "the-guardian-gods"
  getNovelSlug(url) {
    const match = new URL(url).pathname.match(/\/novel\/([^/]+)\//);
    return match ? match[1] : 'unknown-novel';
  },

  // .../chapter-527 -> "527"
  getChapterSlug(url) {
    const match = new URL(url).pathname.match(/chapter-([\w-]+)\/?$/i);
    return match ? match[1] : url.replace(/[^\w-]/g, '_');
  },

  // Pure extraction from an already-loaded cheerio document ($) of the page
  // at `url`. Returns { title, paragraphs, nextUrl }.
  extractChapter($, url) {
    const content = $('#content');
    const chapterTitleTag = $('.chapter-title').first().text().trim();
    const rawTitle = content.find('h4').first().text().trim();
    const title = chapterTitleTag || rawTitle || '';

    const paragraphs = [];
    content.find('p').each((_, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      // skip empty paragraphs, ad-block leftovers, and the stray "."
      // placeholder paragraph this site sometimes leaves at the end.
      if (!text || text === '.') return;
      paragraphs.push(text);
    });

    // The "next chapter" arrow is still rendered even when disabled (i.e.
    // you're on the latest chapter) — sometimes with no href, sometimes
    // with a placeholder like javascript:; or #, sometimes with a
    // disabled/aria-disabled marker. Treat all of those as "no next".
    const nextAnchor = $('a.nextchap').length ? $('a.nextchap') : $('a[rel="next"]');
    const nextHrefRaw = nextAnchor.attr('href');
    const isDisabled =
      nextAnchor.hasClass('disabled') ||
      nextAnchor.attr('aria-disabled') === 'true' ||
      !nextHrefRaw ||
      /^(javascript:|#\s*$)/i.test(nextHrefRaw.trim());

    const nextUrl = isDisabled ? null : new URL(nextHrefRaw, url).toString();

    return { title, paragraphs, nextUrl };
  },
};