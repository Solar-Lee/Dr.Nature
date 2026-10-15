// [P6-02] Create / edit form for a blog post: every field of the admin API, a markdown textarea
// with a live preview, pillar picker, categories and tags (with quick add), SEO fields, status and
// a publish time for scheduling. Saving goes through lib/blog-api.ts; a banned term
// (BLOG_BANNED_TERMS) is listed with its field and reason.
import { Alert, Button, Checkbox, Container, Heading, Input, Label, Select, Switch, Text, Textarea, toast } from "@medusajs/ui"
import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import {
  BlogApiError,
  EMPTY_FORM,
  FIELD_LABELS,
  blogApi,
  browserFetch,
  postToForm,
  type AdminPost,
  type PostForm,
  type Term,
} from "../lib/blog-api"
import { MarkdownPreview } from "./markdown-preview"
import { VisibilityBadge } from "./visibility-badge"

const api = blogApi(browserFetch)

const Field = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <div className="flex flex-col gap-y-1">
    <Label size="small" weight="plus">
      {label}
    </Label>
    {children}
    {hint ? (
      <Text size="xsmall" className="text-ui-fg-subtle">
        {hint}
      </Text>
    ) : null}
  </div>
)

function TermPicker({
  kind,
  label,
  selected,
  onChange,
}: {
  kind: "categories" | "tags"
  label: string
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const [terms, setTerms] = useState<Term[]>([])
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  useEffect(() => {
    api.listTerms(kind).then(setTerms, (e: Error) => toast.error(e.message))
  }, [kind])
  const add = async () => {
    try {
      const t = await api.createTerm(kind, { name, slug })
      setTerms((cur) => [...cur, t])
      onChange([...selected, t.id])
      setName("")
      setSlug("")
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  return (
    <Field label={label}>
      <div className="flex flex-wrap gap-3">
        {terms.map((t) => (
          <label key={t.id} className="flex items-center gap-x-2 txt-small">
            <Checkbox
              checked={selected.includes(t.id)}
              onCheckedChange={(v) => onChange(v === true ? [...selected, t.id] : selected.filter((id) => id !== t.id))}
            />
            {t.name}
          </label>
        ))}
        {!terms.length ? <Text size="small" className="text-ui-fg-muted">（尚無）</Text> : null}
      </div>
      <div className="flex gap-x-2">
        <Input size="small" placeholder="名稱" value={name} onChange={(e) => setName(e.target.value)} />
        <Input size="small" placeholder="slug（英數-）" value={slug} onChange={(e) => setSlug(e.target.value)} />
        <Button size="small" variant="secondary" type="button" disabled={!name.trim() || !slug.trim()} onClick={add}>
          新增
        </Button>
      </div>
    </Field>
  )
}

// `onSaved`: the edit page refreshes its post; without it (create) the page opens the new post.
export function BlogPostForm({ post, onSaved }: { post?: AdminPost; onSaved?: (p: AdminPost) => void }) {
  const navigate = useNavigate()
  const initial = useMemo(() => (post ? postToForm(post) : EMPTY_FORM), [post])
  const [form, setForm] = useState<PostForm>(initial)
  const [pillars, setPillars] = useState<AdminPost[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<BlogApiError | Error | null>(null)
  const set = <K extends keyof PostForm>(key: K, value: PostForm[K]) => setForm((f) => ({ ...f, [key]: value }))

  useEffect(() => {
    api.listPosts({ type: "pillar", limit: 100 }).then(
      (r) => setPillars(r.posts.filter((p) => p.id !== post?.id)),
      (e: Error) => toast.error(e.message)
    )
  }, [post?.id])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      if (post) {
        const saved = await api.updatePost(post.id, form, initial)
        toast.success("已儲存")
        onSaved?.(saved)
      } else {
        const saved = await api.createPost(form)
        toast.success("已建立")
        navigate(`/blog/${saved.id}`)
      }
    } catch (e) {
      setError(e as Error)
    } finally {
      setSaving(false)
    }
  }

  const banned = error instanceof BlogApiError && error.terms.length ? error : null

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-3">
          <Heading level="h1">{post ? "編輯文章" : "新增文章"}</Heading>
          {post ? <VisibilityBadge visibility={post.visibility} /> : null}
        </div>
        <div className="flex gap-x-2">
          <Button variant="secondary" type="button" onClick={() => navigate("/blog")}>
            返回列表
          </Button>
          <Button type="button" isLoading={saving} onClick={save}>
            儲存
          </Button>
        </div>
      </Container>

      {error ? (
        <Alert variant="error" dismissible>
          {banned ? (
            <div className="flex flex-col gap-y-1">
              <Text weight="plus">含不得使用的字詞，不能發佈：{banned.terms.join("、")}</Text>
              {banned.hits.map((h, i) => (
                <Text size="small" key={i}>
                  {FIELD_LABELS[h.field] ?? h.field} 第 {h.line} 行第 {h.column} 字「{h.term}」：{h.reason}
                </Text>
              ))}
              <Text size="small">規則：docs/compliance/claims.md。可先存成草稿再修改。</Text>
            </div>
          ) : (
            error.message
          )}
        </Alert>
      ) : null}

      <Container className="grid grid-cols-1 gap-4 px-6 py-4 md:grid-cols-2">
        <Field label="標題">
          <Input value={form.title} onChange={(e) => set("title", e.target.value)} />
        </Field>
        <Field label="Slug（網址）" hint="小寫英文、數字與單一連字號，例如 gut-basics；發佈後修改會改變網址">
          <Input value={form.slug} onChange={(e) => set("slug", e.target.value)} />
        </Field>
        <Field label="類型" hint="pillar：主題總覽；cluster：子題，必須掛在一篇 pillar 下">
          <Select value={form.type} onValueChange={(v) => set("type", v as PostForm["type"])}>
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="pillar">Pillar（主題總覽）</Select.Item>
              <Select.Item value="cluster">Cluster（子題）</Select.Item>
            </Select.Content>
          </Select>
        </Field>
        {form.type === "cluster" ? (
          <Field label="所屬 pillar">
            <Select value={form.pillar_id || undefined} onValueChange={(v) => set("pillar_id", v)}>
              <Select.Trigger>
                <Select.Value placeholder={pillars.length ? "選擇 pillar" : "尚無 pillar，請先建立"} />
              </Select.Trigger>
              <Select.Content>
                {pillars.map((p) => (
                  <Select.Item key={p.id} value={p.id}>
                    {p.title}（{p.slug}）
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </Field>
        ) : (
          <div />
        )}
        <Field label="狀態" hint="發佈前會檢查禁用詞（docs/compliance/claims.md）">
          <Select value={form.status} onValueChange={(v) => set("status", v as PostForm["status"])}>
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="draft">草稿</Select.Item>
              <Select.Item value="published">發佈</Select.Item>
            </Select.Content>
          </Select>
        </Field>
        <Field label="發佈時間" hint="留空＝按下儲存時立即發佈；填未來時間＝排程，到時間才會出現在前台">
          <Input type="datetime-local" value={form.published_at_local} onChange={(e) => set("published_at_local", e.target.value)} />
        </Field>
        <Field label="作者">
          <Input value={form.author_name} onChange={(e) => set("author_name", e.target.value)} />
        </Field>
        <Field label="摘要">
          <Textarea rows={2} value={form.excerpt} onChange={(e) => set("excerpt", e.target.value)} />
        </Field>
      </Container>

      <Container className="grid grid-cols-1 gap-4 px-6 py-4 lg:grid-cols-2">
        <Field label="內文（Markdown）" hint="支援 # 標題、**粗體**、*斜體*、清單、> 引言、``` 程式碼、[連結](https://...)；HTML 只會顯示為文字">
          <Textarea className="min-h-[420px] font-mono" value={form.body_markdown} onChange={(e) => set("body_markdown", e.target.value)} />
        </Field>
        <Field label="預覽">
          <div className="min-h-[420px] rounded-md border border-ui-border-base p-4">
            <MarkdownPreview source={form.body_markdown} />
          </div>
        </Field>
      </Container>

      <Container className="grid grid-cols-1 gap-4 px-6 py-4 md:grid-cols-2">
        <TermPicker kind="categories" label="分類" selected={form.category_ids} onChange={(ids) => set("category_ids", ids)} />
        <TermPicker kind="tags" label="標籤" selected={form.tag_ids} onChange={(ids) => set("tag_ids", ids)} />
      </Container>

      <Container className="grid grid-cols-1 gap-4 px-6 py-4 md:grid-cols-2">
        <Heading level="h2" className="md:col-span-2">
          SEO
        </Heading>
        <Field label="SEO 標題" hint="空白時前台用文章標題">
          <Input value={form.meta_title} onChange={(e) => set("meta_title", e.target.value)} />
        </Field>
        <Field label="Canonical 網址" hint="https://… ；空白＝文章本身的網址">
          <Input value={form.canonical_url} onChange={(e) => set("canonical_url", e.target.value)} />
        </Field>
        <Field label="SEO 描述">
          <Textarea rows={2} value={form.meta_description} onChange={(e) => set("meta_description", e.target.value)} />
        </Field>
        <Field label="OG 圖片網址" hint="https://…">
          <Input value={form.og_image_url} onChange={(e) => set("og_image_url", e.target.value)} />
        </Field>
        <label className="flex items-center gap-x-2 txt-small">
          <Switch checked={form.noindex} onCheckedChange={(v) => set("noindex", v)} />
          noindex（不讓搜尋引擎收錄這篇）
        </label>
      </Container>
    </div>
  )
}
