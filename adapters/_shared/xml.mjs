// _shared/xml.mjs - just enough XML to read a job feed, and nothing else.
//
// One applicant tracking system answers RSS and five answer JSON. A parser
// dependency for one feed is not worth having; a general XML parser written
// here would be worse. This reads one repeated element and its children by
// name, which is the whole shape of an RSS job feed.
//
// What it is not, all true of the feeds in notes/ats.md: namespaces are not
// resolved (`tt:city` is a name, matched literally), attributes are ignored,
// a field holding nested elements hands back that markup, and elements of one
// name are assumed not to nest. A feed needing more needs a parser.
//
// Structure here, text in _shared/text.mjs: `field` unwraps CDATA and decodes
// nothing.

const quote = (tag) => String(tag).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const paired = (tag, flags) =>
  new RegExp(`<${quote(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${quote(tag)}>`, flags);

const selfClosing = (tag) => new RegExp(`<${quote(tag)}(?:\\s[^>]*)?/>`);

const unwrapCdata = (s) => s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');

/** The inner XML of every `<tag>...</tag>`, in document order. */
export function elements(xml, tag) {
  return [...String(xml ?? '').matchAll(paired(tag, 'g'))].map((m) => m[1]);
}

/**
 * The raw text of the first `<tag>`, `''` where the feed states it empty, and
 * `null` where the feed does not state it at all.
 */
export function field(xml, tag) {
  const s = String(xml ?? '');
  const found = s.match(paired(tag));
  if (found) return unwrapCdata(found[1]);
  return selfClosing(tag).test(s) ? '' : null;
}
