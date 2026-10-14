// [P6-02] Admin route /app/blog: post list (status filter, pagination) and the category / tag
// lists. Content editors and Super Admin only: the admin API answers 403 to other roles
// (src/api/middlewares.ts), and the page then shows that message.
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Button, Container, Heading, Input, Select, Table, Text, toast, usePrompt } from "@medusajs/ui"
import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { VisibilityBadge } from "../../components/visibility-badge"
import { blogApi, browserFetch, type AdminPost, type Term } from "../../lib/blog-api"

const api = blogApi(browserFetch)
const PAGE = 20

const BlogIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
    <path d="M3 2.5h6l3 3v7H3z M9 2.5v3h3 M5 8h5 M5 10.5h5" stroke="currentColor" strokeLinejoin="round" />
  </svg>
)

function TermList({ kind, label }: { kind: "categories" | "tags"; label: string }) {
  const prompt = usePrompt()
  const [terms, setTerms] = useState<Term[]>([])
  const load = () => api.listTerms(kind).then(setTerms, (e: Error) => toast.error(e.message))
  useEffect(() => {
    load()
  }, [kind])
  const remove = async (t: Term) => {
    if (!(await prompt({ title: `刪除「${t.name}」？`, description: "文章不會被刪除，只會移除這個關聯。", confirmText: "刪除", cancelText: "取消" }))) return
    try {
      await api.deleteTerm(kind, t.id)
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  return (
    <div className="flex flex-col gap-y-2">
      <Heading level="h3">{label}</Heading>
      {terms.map((t) => (
        <div key={t.id} className="flex items-center justify-between txt-small">
          <span>
            {t.name} <span className="text-ui-fg-subtle">/{t.slug}</span>
          </span>
          <Button size="small" variant="transparent" onClick={() => remove(t)}>
            刪除
          </Button>
        </div>
      ))}
      {!terms.length ? <Text size="small" className="text-ui-fg-muted">（尚無，可在文章表單中新增）</Text> : null}
    </div>
  )
}

const BlogListPage = () => {
  const navigate = useNavigate()
  const [status, setStatus] = useState("all")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(0)
  const [data, setData] = useState<{ posts: AdminPost[]; count: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .listPosts({ status: status === "all" ? undefined : status, q: q || undefined, limit: PAGE, offset: page * PAGE })
      .then(setData, (e: Error) => setError(e.message))
  }, [status, q, page])

  const pageCount = Math.max(1, Math.ceil((data?.count ?? 0) / PAGE))
  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <Heading level="h1">Blog 文章</Heading>
          <Button size="small" onClick={() => navigate("/blog/create")}>
            新增文章
          </Button>
        </div>
        <div className="flex gap-x-2 px-6 py-3">
          <Input size="small" type="search" placeholder="搜尋標題或 slug" value={q} onChange={(e) => {
              setPage(0)
              setQ(e.target.value)
            }} />
          <Select size="small" value={status} onValueChange={(v) => {
              setPage(0)
              setStatus(v)
            }}>
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="all">全部</Select.Item>
              <Select.Item value="draft">草稿</Select.Item>
              <Select.Item value="published">已發佈／排程</Select.Item>
            </Select.Content>
          </Select>
        </div>
        {error ? (
          <Text className="px-6 py-4 text-ui-fg-error">{error}</Text>
        ) : (
          <>
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>標題</Table.HeaderCell>
                  <Table.HeaderCell>類型</Table.HeaderCell>
                  <Table.HeaderCell>所屬 pillar</Table.HeaderCell>
                  <Table.HeaderCell>狀態</Table.HeaderCell>
                  <Table.HeaderCell>發佈時間</Table.HeaderCell>
                  <Table.HeaderCell>更新</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {(data?.posts ?? []).map((p) => (
                  <Table.Row key={p.id} className="cursor-pointer" onClick={() => navigate(`/blog/${p.id}`)}>
                    <Table.Cell>
                      <Link to={`/blog/${p.id}`}>{p.title}</Link>
                      <div className="text-ui-fg-subtle txt-compact-xsmall">/{p.slug}</div>
                    </Table.Cell>
                    <Table.Cell>{p.type}</Table.Cell>
                    <Table.Cell>{p.pillar?.title ?? "—"}</Table.Cell>
                    <Table.Cell>
                      <VisibilityBadge visibility={p.visibility} />
                    </Table.Cell>
                    <Table.Cell>{p.published_at ? new Date(p.published_at).toLocaleString() : "—"}</Table.Cell>
                    <Table.Cell>{new Date(p.updated_at).toLocaleString()}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
            <Table.Pagination
              count={data?.count ?? 0}
              pageSize={PAGE}
              pageIndex={page}
              pageCount={pageCount}
              canPreviousPage={page > 0}
              canNextPage={page + 1 < pageCount}
              previousPage={() => setPage((x) => x - 1)}
              nextPage={() => setPage((x) => x + 1)}
            />
          </>
        )}
      </Container>
      <Container className="grid grid-cols-1 gap-6 px-6 py-4 md:grid-cols-2">
        <TermList kind="categories" label="分類" />
        <TermList kind="tags" label="標籤" />
      </Container>
    </div>
  )
}

export const config = defineRouteConfig({ label: "Blog", icon: BlogIcon })

export default BlogListPage
