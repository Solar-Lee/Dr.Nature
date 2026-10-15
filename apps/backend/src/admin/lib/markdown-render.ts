// [P6-02] React elements for the markdown.ts tree. Text only ever becomes React text children
// (escaped by React); nothing here sets inner HTML (the unit test checks the source). Plain .ts (createElement, no JSX) so
// the unit test can render it with react-dom/server.
import { createElement as h, type ReactNode } from "react"
import { parseMarkdown, type Block, type Inline } from "./markdown"

function inline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.type) {
      case "text":
        return n.text
      case "strong":
        return h("strong", { key: i }, ...inline(n.children))
      case "em":
        return h("em", { key: i }, ...inline(n.children))
      case "code":
        return h("code", { key: i, className: "rounded bg-ui-bg-subtle px-1 font-mono text-xs" }, n.text)
      case "link":
        return h("a", { key: i, href: n.href, target: "_blank", rel: "noopener noreferrer nofollow", className: "text-ui-fg-interactive underline" }, ...inline(n.children))
      case "image":
        return h("img", { key: i, src: n.src, alt: n.alt, referrerPolicy: "no-referrer", style: { maxWidth: "100%" } })
    }
  })
}

const HEADING_CLASS = ["", "text-2xl font-semibold", "text-xl font-semibold", "text-lg font-semibold", "text-base font-semibold", "text-sm font-semibold", "text-sm font-semibold"]

function block(b: Block, i: number): ReactNode {
  switch (b.type) {
    case "heading":
      return h(`h${b.level}`, { key: i, className: `${HEADING_CLASS[b.level]} mt-4 mb-2` }, ...inline(b.children))
    case "paragraph":
      return h("p", { key: i, className: "my-2", style: { whiteSpace: "pre-line" } }, ...inline(b.children))
    case "list":
      return h(
        b.ordered ? "ol" : "ul",
        { key: i, className: `my-2 pl-6 ${b.ordered ? "list-decimal" : "list-disc"}` },
        ...b.items.map((item, j) => h("li", { key: j, style: { whiteSpace: "pre-line" } }, ...inline(item)))
      )
    case "code":
      return h("pre", { key: i, className: "my-2 overflow-x-auto rounded bg-ui-bg-subtle p-3 font-mono text-xs" }, b.text)
    case "quote":
      return h("blockquote", { key: i, className: "my-2 border-l-4 border-ui-border-base pl-3 text-ui-fg-subtle" }, ...b.children.map(block))
    case "hr":
      return h("hr", { key: i, className: "my-4" })
  }
}

export function renderMarkdown(src: string): ReactNode[] {
  return parseMarkdown(src).map(block)
}
