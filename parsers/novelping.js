/**
 * parsers/novelping.js — extraction logic specific to novelping.com.
 *
 * Chapter URLs carry a title slug after the number, so they can't be
 * guessed:
 *   https://novelping.com/book/<novel>/chapter-2-the-place-where-everything-fell-down
 * Chapter pages have a reliable "Next Chapter" link, so the crawl itself
 * works like any other site. For starting from the book URL plus a chapter
 * number, the full chapter list comes from /ajax/chapter-archive: the book
 * page's own HTML only ships the first 30 chapters and loads the rest with
 * JavaScript.
 */

function hostnameOf(url) {
  return new URL(url).hostname.replace(/^www\./, '');
}

module.exports = {
  id: 'novelping.com',
  name: 'NovelPing',

  matches(url) {
    return hostnameOf(url) === 'novelping.com';
  },

  // https://novelping.com/book/<novel> (no chapter part) -> true
  isIndexUrl(url) {
    return /^\/book\/[^/]+\/?$/.test(new URL(url).pathname);
  },

  // https://novelping.com/book/shattered-innocence-.../chapter-2-... -> "shattered-innocence-..."
  getNovelSlug(url) {
    const match = new URL(url).pathname.match(/\/book\/([^/]+)/);
    return match ? match[1] : 'unknown-novel';
  },

  // .../chapter-2-the-place-where-everything-fell-down -> "2". Chapter
  // numbers are unique on this site, and dropping the title part keeps the
  // output file names (chapter-2.md) short and predictable.
  getChapterSlug(url) {
    const match = new URL(url).pathname.match(/\/chapter-(\d+)(?:-[^/]*)?\/?$/i);
    return match ? match[1] : url.replace(/[^\w-]/g, '_');
  },

  // Where the full chapter list lives for a book URL.
  getChapterListUrl(url) {
    const novel = encodeURIComponent(this.getNovelSlug(url));
    return `https://novelping.com/ajax/chapter-archive?novelId=${novel}`;
  },

  // Every chapter in reading order, as [{ number, title, url }]. Works on the
  // chapter-archive response (items inside <template>) and on a fully
  // rendered book page.
  getChapterList($, url) {
    const chapters = [];
    $('li[data-chapter-item] a[href]').each((_, el) => {
      const chapterUrl = new URL($(el).attr('href'), url).toString();
      const number = this.getChapterSlug(chapterUrl);
      const title = ($(el).attr('title') || $(el).find('.chapter-title').text()).trim();
      chapters.push({ number, title, url: chapterUrl });
    });
    return chapters;
  },

  // Pure extraction from an already-loaded cheerio document ($) of the page
  // at `url`. Returns { title, paragraphs, nextUrl }.
  extractChapter($, url) {
    const content = $('#chr-content');
    const title = $('#chapter h2').first().text().replace(/\s+/g, ' ').trim();

    // Only direct <p> children: ads sit in sibling div.js-ad-slot elements.
    const paragraphs = [];
    content.children('p').each((_, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      if (text) paragraphs.push(text);
    });

    // On the latest chapter the "next" button stays on the page, but with
    // a disabled attribute, href="javascript:void(0)" and an empty
    // data-chapter-url.
    const nextAnchor = $('a.js-chapter-nav[data-chapter-nav="next"]').first();
    const nextHrefRaw = nextAnchor.attr('data-chapter-url') || nextAnchor.attr('href');
    const isDisabled =
      nextAnchor.attr('disabled') !== undefined ||
      !nextHrefRaw ||
      /^(javascript:|#\s*$)/i.test(nextHrefRaw.trim());

    const nextUrl = isDisabled ? null : new URL(nextHrefRaw, url).toString();

    return { title, paragraphs, nextUrl };
  },
};
