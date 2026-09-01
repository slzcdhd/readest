/**
 * Extract a section's flat text from its DOM, using the same TreeWalker +
 * skip-tag discipline as CfiChunker so the character offsets quoteMatcher
 * reports land in the SAME coordinate system the reader's CFI resolution
 * uses (plan §2.3 "取文"). Pure function, no foliate-js text-walker dependency,
 * so it runs under jsdom in tests.
 */

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

/**
 * Concatenate the visible text of a section document. Skips script/style/
 * noscript/template and any node under a `.cfi-inert` ancestor.
 */
export function extractSectionText(doc: Document): string {
  const body = doc.body ?? doc.documentElement;
  if (!body) return '';

  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let p: Node | null = node.parentNode;
      while (p && p.nodeType === 1) {
        const el = p as Element;
        if (SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
        if (el.classList?.contains('cfi-inert')) return NodeFilter.FILTER_REJECT;
        p = p.parentNode;
      }
      return (node.nodeValue ?? '').length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });

  const parts: string[] = [];
  let n: Node | null = walker.nextNode();
  while (n) {
    parts.push((n as Text).nodeValue ?? '');
    n = walker.nextNode();
  }
  return parts.join('');
}

/** True when a section yields no extractable text (image-only / scanned). */
export function isImageOnlySection(text: string): boolean {
  return text.trim().length === 0;
}
