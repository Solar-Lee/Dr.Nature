// [P6-01] Blog post. A pillar is a hub article; a cluster is a narrower article that MUST point to
// one pillar (enforced in src/lib/blog/posts.ts, which is the only write path). Visibility in the
// Store API: status "published" AND published_at <= now; a published post with a future
// published_at is "scheduled". DML API checked against @medusajs/utils 2.21.2 (dml/entity-builder,
// self relation as in @medusajs/product ProductCategory, many-to-many as in Product.categories).
import { model } from "@medusajs/framework/utils"
import BlogCategory from "./blog-category"
import BlogTag from "./blog-tag"

const BlogPost = model
  .define({ name: "BlogPost", tableName: "blog_post" }, {
    id: model.id({ prefix: "bpost" }).primaryKey(),
    title: model.text(),
    slug: model.text(),
    type: model.enum(["pillar", "cluster"]),
    pillar: model.belongsTo(() => BlogPost, { mappedBy: "clusters" }).nullable(),
    clusters: model.hasMany(() => BlogPost, { mappedBy: "pillar" }),
    excerpt: model.text().nullable(),
    body_markdown: model.text().default(""),
    status: model.enum(["draft", "published"]).default("draft"),
    published_at: model.dateTime().nullable(),
    author_name: model.text().nullable(),
    meta_title: model.text().nullable(),
    meta_description: model.text().nullable(),
    canonical_url: model.text().nullable(),
    og_image_url: model.text().nullable(),
    noindex: model.boolean().default(false),
    categories: model.manyToMany(() => BlogCategory, { mappedBy: "posts", pivotTable: "blog_post_category" }),
    tags: model.manyToMany(() => BlogTag, { mappedBy: "posts", pivotTable: "blog_post_tag" }),
  })
  .indexes([
    { name: "IDX_blog_post_slug_unique", on: ["slug"], unique: true, where: "deleted_at IS NULL" },
    { name: "IDX_blog_post_visible", on: ["status", "published_at"], where: "deleted_at IS NULL" },
  ])

export default BlogPost
