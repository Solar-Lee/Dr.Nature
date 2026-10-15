// [P6-01] Blog tag (name + unique URL slug); many-to-many with BlogPost (pivot blog_post_tag).
import { model } from "@medusajs/framework/utils"
import BlogPost from "./blog-post"

const BlogTag = model
  .define({ name: "BlogTag", tableName: "blog_tag" }, {
    id: model.id({ prefix: "btag" }).primaryKey(),
    name: model.text(),
    slug: model.text(),
    posts: model.manyToMany(() => BlogPost, { mappedBy: "tags" }),
  })
  .indexes([{ name: "IDX_blog_tag_slug_unique", on: ["slug"], unique: true, where: "deleted_at IS NULL" }])

export default BlogTag
