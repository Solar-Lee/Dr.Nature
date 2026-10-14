// [P6-01] Blog RBAC resources (one per entity, like Medusa's product / product_category).
// Policies are registered in src/policies/blog.ts; the content_editor role holds all of them
// (src/lib/rbac-roles.ts), Super Admin has *:*, every other staff role has none.
export const BLOG_RESOURCES = ["blog_post", "blog_category", "blog_tag"] as const
export type BlogResource = (typeof BLOG_RESOURCES)[number]

export const BLOG_POLICY_KEYS: string[] = BLOG_RESOURCES.flatMap((r) =>
  ["read", "create", "update", "delete"].map((o) => `${r}:${o}`)
)
