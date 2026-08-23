/**
 * extension/parsers/novelphoenix.js
 *
 * Browser port of the Node-side parsers/novelphoenix.js. Same matching and
 * slug logic, but getParagraphElements works against the live document
 * with querySelector/textContent instead of cheerio against fetched HTML.
 *
 * Registers itself on window.NovelDeslopParsers, which parsers/index.js
 * (loaded next, per manifest.json's content_scripts order) reads from.
 */

(function () {
  function hostnameOf(url) {
    return new URL(url).hostname.replace(/^www\./, '');
  }

  window.NovelDeslopParsers = window.NovelDeslopParsers || [];
  window.NovelDeslopParsers.push({
    id: 'novelphoenix.com',

    matches(url) {
      return hostnameOf(url) === 'novelphoenix.com';
    },

    getNovelSlug(url) {
      const match = new URL(url).pathname.match(/\/novel\/([^/]+)\//);
      return match ? match[1] : null;
    },

    getChapterSlug(url) {
      const match = new URL(url).pathname.match(/chapter-([\w-]+)\/?$/i);
      return match ? match[1] : null;
    },

    // Ordered list of "real" paragraph elements on the current page — same
    // filtering as the Node-side extractChapter (skip empty, skip the
    // stray "." placeholder) so the count lines up with what was used to
    // generate the rewrite that's about to be swapped in.
    getParagraphElements(doc) {
      const content = doc.querySelector('#content');
      if (!content) return [];
      return Array.from(content.querySelectorAll('p')).filter((el) => {
        const text = el.textContent.replace(/\s+/g, ' ').trim();
        return text && text !== '.';
      });
    },
  });
})();