// [P6-02] Live preview of a post body (lib/markdown.ts + lib/markdown-render.ts): raw HTML in
// the body is shown as text and never runs.
import { renderMarkdown } from "../lib/markdown-render"

export const MarkdownPreview = ({ source }: { source: string }) => (
  <div className="txt-small text-ui-fg-base break-words">{source.trim() ? renderMarkdown(source) : <p className="text-ui-fg-muted">（預覽）</p>}</div>
)
