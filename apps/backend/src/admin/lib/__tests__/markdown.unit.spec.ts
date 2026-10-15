// [P6-02] Editor preview: the markdown subset renders as expected and a post body can never run
// HTML or script in the admin (raw HTML stays text, unsafe link / image targets stay text).
// Cannot prove: that the storefront renderer (P6-03) shows the same thing; this is a preview.
import { readFileSync } from "fs"
import { join } from "path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { parseInline, parseMarkdown, safeUrl } from "../markdown"
import { renderMarkdown } from "../markdown-render"

const html = (src: string) => renderToStaticMarkup(createElement("div", null, ...renderMarkdown(src)))

describe("markdown preview", () => {
  it("headings, paragraphs, lists, quotes, code, rules", () => {
    const src = [
      "# 標題",
      "",
      "第一行",
      "第二行 **粗體** 與 *斜體* 與 `code`",
      "",
      "- 一",
      "- 二",
      "",
      "1. 甲",
      "2. 乙",
      "",
      "> 引言",
      "",
      "```",
      "<b>不是 HTML</b>",
      "```",
      "",
      "---",
    ].join("\n")
    expect(parseMarkdown(src).map((b) => b.type)).toEqual(["heading", "paragraph", "list", "list", "quote", "code", "hr"])
    expect(html(src)).toEqual(
      '<div><h1 class="text-2xl font-semibold mt-4 mb-2">標題</h1>' +
        '<p class="my-2" style="white-space:pre-line">第一行\n第二行 <strong>粗體</strong> 與 <em>斜體</em> 與 <code class="rounded bg-ui-bg-subtle px-1 font-mono text-xs">code</code></p>' +
        '<ul class="my-2 pl-6 list-disc"><li style="white-space:pre-line">一</li><li style="white-space:pre-line">二</li></ul>' +
        '<ol class="my-2 pl-6 list-decimal"><li style="white-space:pre-line">甲</li><li style="white-space:pre-line">乙</li></ol>' +
        '<blockquote class="my-2 border-l-4 border-ui-border-base pl-3 text-ui-fg-subtle"><p class="my-2" style="white-space:pre-line">引言</p></blockquote>' +
        '<pre class="my-2 overflow-x-auto rounded bg-ui-bg-subtle p-3 font-mono text-xs">&lt;b&gt;不是 HTML&lt;/b&gt;</pre>' +
        '<hr class="my-4"/></div>'
    )
  })

  it("raw HTML in the body is shown as text, never as markup", () => {
    const out = html('<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n\n<a href="javascript:alert(3)">x</a>')
    expect(out).not.toMatch(/<script|<img|<a /)
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
    expect(out).toContain("&lt;img src=x onerror=&quot;alert(2)&quot;&gt;")
  })

  it("links and images only for http(s), root-relative and # targets", () => {
    expect(safeUrl("https://dr.nature.smilelife.tw/a")).toEqual("https://dr.nature.smilelife.tw/a")
    expect(safeUrl("/blog/a")).toEqual("/blog/a")
    expect(safeUrl("#toc")).toEqual("#toc")
    for (const bad of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,x", "//evil.example/x", "vbscript:x", "mailto:a@b.c"]) {
      expect([bad, safeUrl(bad)]).toEqual([bad, null])
    }
    expect(parseInline("[ok](https://a.example/x)")).toEqual([{ type: "link", href: "https://a.example/x", children: [{ type: "text", text: "ok" }] }])
    expect(parseInline("[bad](javascript:alert(1))")).toEqual([{ type: "text", text: "[bad](javascript:alert(1))" }])
    expect(html("[bad](javascript:alert(1))")).not.toContain("href")
    expect(html("![p](data:image/png;base64,AAAA)")).not.toContain("<img")
    expect(html("![圖](https://cdn.example/a.png)")).toEqual(
      '<div><p class="my-2" style="white-space:pre-line"><img src="https://cdn.example/a.png" alt="圖" referrerPolicy="no-referrer" style="max-width:100%"/></p></div>'
    )
    expect(html("[站內](/blog/x)")).toContain('href="/blog/x" target="_blank" rel="noopener noreferrer nofollow"')
  })

  it("the renderer source never injects HTML", () => {
    for (const f of ["../markdown-render.ts", "../markdown.ts", "../../components/markdown-preview.tsx"]) {
      expect([f, /dangerouslySetInnerHTML|innerHTML/.test(readFileSync(join(__dirname, f), "utf8"))]).toEqual([f, false])
    }
  })
})
