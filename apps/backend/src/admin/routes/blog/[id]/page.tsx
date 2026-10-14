// [P6-02] Admin route /app/blog/:id: edit a post, see its clusters (for a pillar), delete it.
import { Button, Container, Heading, Text, toast, usePrompt } from "@medusajs/ui"
import { useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { BlogPostForm } from "../../../components/blog-post-form"
import { VisibilityBadge } from "../../../components/visibility-badge"
import { blogApi, browserFetch, type AdminPost } from "../../../lib/blog-api"

const api = blogApi(browserFetch)

const BlogEditPage = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const prompt = usePrompt()
  const [post, setPost] = useState<AdminPost | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (id) api.getPost(id).then(setPost, (e: Error) => setError(e.message))
  }, [id])

  const remove = async () => {
    if (!post) return
    const ok = await prompt({
      title: `刪除「${post.title}」？`,
      description: "刪除後無法復原。還掛著 cluster 的 pillar 不能刪除。",
      confirmText: "刪除",
      cancelText: "取消",
    })
    if (!ok) return
    try {
      await api.deletePost(post.id)
      toast.success("已刪除")
      navigate("/blog")
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  if (error) return <Container className="px-6 py-4"><Text className="text-ui-fg-error">{error}</Text></Container>
  if (!post) return <Container className="px-6 py-4"><Text>載入中…</Text></Container>
  return (
    <div className="flex flex-col gap-y-3">
      <BlogPostForm key={post.updated_at} post={post} onSaved={setPost} />
      {post.type === "pillar" ? (
        <Container className="flex flex-col gap-y-2 px-6 py-4">
          <Heading level="h2">這篇 pillar 的 cluster</Heading>
          {(post.clusters ?? []).map((c) => (
            <div key={c.id} className="flex items-center gap-x-2 txt-small">
              <Link to={`/blog/${c.id}`}>{c.title}</Link>
              <VisibilityBadge visibility={c.visibility as AdminPost["visibility"]} />
            </div>
          ))}
          {!post.clusters?.length ? <Text size="small" className="text-ui-fg-muted">（尚無）</Text> : null}
        </Container>
      ) : null}
      <Container className="flex justify-end px-6 py-4">
        <Button variant="danger" onClick={remove}>
          刪除文章
        </Button>
      </Container>
    </div>
  )
}

export default BlogEditPage
