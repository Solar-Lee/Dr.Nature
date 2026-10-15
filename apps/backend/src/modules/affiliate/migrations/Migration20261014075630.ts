import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261014075630 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "affiliate_store" drop constraint if exists "affiliate_store_slug_unique";`);
    this.addSql(`alter table if exists "affiliate_partner" drop constraint if exists "affiliate_partner_tuangou_kol_id_unique";`);
    this.addSql(`create table if not exists "affiliate_partner" ("id" text not null, "display_name" text not null, "tuangou_kol_id" text null, "ig_handle" text null, "status" text check ("status" in ('active', 'inactive')) not null default 'active', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "affiliate_partner_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_affiliate_partner_tuangou_kol_id_unique" ON "affiliate_partner" ("tuangou_kol_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_affiliate_partner_deleted_at" ON "affiliate_partner" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "affiliate_store" ("id" text not null, "slug" text not null, "title" text not null, "product_ids" text[] not null, "starts_at" timestamptz not null, "ends_at" timestamptz not null, "status" text check ("status" in ('draft', 'active', 'ended')) not null default 'draft', "price_list_id" text null, "partner_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "affiliate_store_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_affiliate_store_slug_unique" ON "affiliate_store" ("slug") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_affiliate_store_partner_id" ON "affiliate_store" ("partner_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_affiliate_store_deleted_at" ON "affiliate_store" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "affiliate_store" add constraint "affiliate_store_partner_id_foreign" foreign key ("partner_id") references "affiliate_partner" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "affiliate_store" drop constraint if exists "affiliate_store_partner_id_foreign";`);

    this.addSql(`drop table if exists "affiliate_partner" cascade;`);

    this.addSql(`drop table if exists "affiliate_store" cascade;`);
  }

}
