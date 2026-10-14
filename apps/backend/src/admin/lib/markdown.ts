// [P6-02] Markdown preview for the blog editor, without a new dependency (none is in the
// lockfile). Parses a common subset into a small tree; markdown-render.ts turns it into React
// elements. There is no HTML node type: raw HTML in the body stays literal text, and React
// escapes text, so nothing in a post body can run in the admin. Links and images are kept only
// for http(s), root-relative ("/...") and "#" targets; anything else stays plain text.
// Supported: # headings, paragraphs (line breaks kept), - * + and 1. lists, > quotes, ``` code
// blocks, --- rules, `code`, **bold** / __bold__, *italic*, [text](url), ![alt](url).
// The storefront renderer is chosen in P6-03; this preview is an approximation of it.

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: Inline[] }
  | { type: "image"; src: string; alt: string }

export type Block =
  | { type: "heading"; level: number; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "code"; text: string }
  | { type: "quote"; children: Block[] }
  | { type: "hr" }

export function safeUrl(url: string): string | null {
  const u = url.trim()
  if (/^https?:\/\/[^\s]+$/i.test(u)) return u
  if (/^\/(?!\/)[^\s]*$/.test(u)) return u
  if (/^#[^\s]*$/.test(u)) return u
  return null
}

// Earliest inline construct wins; text before it is plain text.
const INLINE = /(`+)([\s\S]*?)\1|!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*/

export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let rest = src
  const pushText = (text: string) => {
    if (!text) return
    const last = out[out.length - 1]
    if (last?.type === "text") last.text += text
    else out.push({ type: "text", text })
  }
  while (rest) {
    const m = INLINE.exec(rest)
    if (!m) {
      pushText(rest)
      break
    }
    pushText(rest.slice(0, m.index))
    const [whole, ticks, code, alt, imgUrl, linkText, linkUrl, strong1, strong2, em] = m
    if (ticks !== undefined) {
      out.push({ type: "code", text: code })
    } else if (imgUrl !== undefined) {
      const src2 = safeUrl(imgUrl)
      if (src2) out.push({ type: "image", src: src2, alt })
      else pushText(whole)
    } else if (linkUrl !== undefined) {
      const href = safeUrl(linkUrl)
      if (href) out.push({ type: "link", href, children: parseInline(linkText) })
      else pushText(whole)
    } else if (strong1 !== undefined || strong2 !== undefined) {
      out.push({ type: "strong", children: parseInline(strong1 ?? strong2) })
    } else {
      out.push({ type: "em", children: parseInline(em) })
    }
    rest = rest.slice(m.index + whole.length)
  }
  return out
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/
const ORDERED = /^\s{0,3}\d{1,9}[.)]\s+(.*)$/
const QUOTE = /^\s{0,3}>\s?(.*)$/
const FENCE = /^\s{0,3}```/

const startsBlock = (line: string) =>
  HEADING.test(line) || HR.test(line) || BULLET.test(line) || ORDERED.test(line) || QUOTE.test(line) || FENCE.test(line)

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n")
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    if (FENCE.test(line)) {
      const body: string[] = []
      i++
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++])
      i++ // closing fence (or end of input)
      blocks.push({ type: "code", text: body.join("\n") })
      continue
    }
    const h = HEADING.exec(line)
    if (h) {
      blocks.push({ type: "heading", level: h[1].length, children: parseInline(h[2]) })
      i++
      continue
    }
    if (HR.test(line)) {
      blocks.push({ type: "hr" })
      i++
      continue
    }
    if (QUOTE.test(line)) {
      const body: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) body.push((QUOTE.exec(lines[i++]) as RegExpExecArray)[1])
      blocks.push({ type: "quote", children: parseMarkdown(body.join("\n")) })
      continue
    }
    const ordered = ORDERED.test(line)
    if (ordered || BULLET.test(line)) {
      const re = ordered ? ORDERED : BULLET
      const items: string[] = []
      while (i < lines.length && lines[i].trim()) {
        const m = re.exec(lines[i])
        if (m) items.push(m[1])
        else if (startsBlock(lines[i])) break
        else items[items.length - 1] += `\n${lines[i].trim()}`
        i++
      }
      blocks.push({ type: "list", ordered, items: items.map(parseInline) })
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) para.push(lines[i++])
    blocks.push({ type: "paragraph", children: parseInline(para.join("\n")) })
  }
  return blocks
}
