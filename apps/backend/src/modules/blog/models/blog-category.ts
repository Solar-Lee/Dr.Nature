// [P6-01] Blog category (name + unique URL slug); many-to-many with BlogPost (pivot blog_post_category).
import { model } from "@medusajs/framework/utils"
import BlogPost from "./blog-post"

const BlogCategory = model
  .define({ name: "BlogCategory", tableName: "blog_category" }, {
    id: model.id({ prefix: "bcat" }).primaryKey(),
    name: model.text(),
    slug: model.text(),
    posts: model.manyToMany(() => BlogPost, { mappedBy: "categories" }),
  })
  .indexes([{ name: "IDX_blog_category_slug_unique", on: ["slug"], unique: true, where: "deleted_at IS NULL" }])

export default BlogCategory
