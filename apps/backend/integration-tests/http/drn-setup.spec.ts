// Acceptance tests for P3-03 (Taiwan store, TWD tax-inclusive, 5% tax), P3-04 (catalog),
// P3-05 (sales channels + publishable keys) and P3-07 (RBAC roles).
//
// Migration scripts do not run inside medusaIntegrationTestRunner, so the suite calls the
// drn-* script functions itself in beforeAll. The runner snapshots the database after
// beforeAll and restores it before every test, so each test starts from the seeded state.
//
// Run: cd apps/backend && ../../infra/test-env.sh pnpm run test:integration:http
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import type { IRbacModuleService, MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
  generateJwtToken,
} from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import drnTwStoreRegionTax from "../../src/migration-scripts/drn-0001-tw-store-region-tax"
import drnSalesChannelsAndKeys from "../../src/migration-scripts/drn-0002-sales-channels-and-keys"
import drnCatalog from "../../src/migration-scripts/drn-0003-catalog"
import drnRbacRoles from "../../src/migration-scripts/drn-0004-rbac-roles"
import devAddTestStock from "../../src/scripts/dev-add-test-stock"
import catalog from "../../src/data/catalog.json"
import {
  PUBLISHABLE_KEYS,
  REGION_NAME,
  SALES_CHANNELS,
  STOCK_LOCATION_NAME,
  TAX_RATE,
} from "../../src/lib/drn-setup"
import { ROLE_DEFINITIONS } from "../../src/lib/rbac-roles"

jest.setTimeout(120 * 1000)

const runAllSeeds = async (container: MedusaContainer) => {
  await drnTwStoreRegionTax({ container })
  await drnSalesChannelsAndKeys({ container })
  await drnCatalog({ container })
  await drnRbacRoles({ container })
}

const publishableToken = async (container: MedusaContainer, title: string) => {
  const [key] = await container
    .resolve(Modules.API_KEY)
    .listApiKeys({ title, type: "publishable" })
  if (!key) {
    throw new Error(`publishable key "${title}" not seeded`)
  }
  return key.token
}

// Creates a staff user (optionally with one RBAC role) and returns admin auth headers.
// Role IDs travel in the JWT's app_metadata.roles, as Medusa puts them at login.
const adminHeadersFor = async (
  container: MedusaContainer,
  email: string,
  roleName?: string
) => {
  const userModule = container.resolve(Modules.USER)
  const authModule = container.resolve(Modules.AUTH)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const { http } = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE).projectConfig

  const user = await userModule.createUsers({ email })
  const authIdentity = await authModule.createAuthIdentities({
    provider_identities: [{ provider: "emailpass", entity_id: email }],
    app_metadata: { user_id: user.id },
  })
  const roles: string[] = []
  if (roleName) {
    const rbac = container.resolve<IRbacModuleService>(Modules.RBAC)
    const [role] = await rbac.listRbacRoles({ name: roleName })
    if (!role) {
      throw new Error(`role ${roleName} not found`)
    }
    await link.create({
      [Modules.USER]: { user_id: user.id },
      [Modules.RBAC]: { rbac_role_id: role.id },
    })
    roles.push(role.id)
  }
  const token = generateJwtToken(
    {
      actor_id: user.id,
      actor_type: "user",
      auth_identity_id: authIdentity.id,
      app_metadata: { user_id: user.id, roles },
    },
    { secret: http.jwtSecret as string, expiresIn: "1d" }
  )
  return { authorization: `Bearer ${token}` }
}

const statusOf = async (p: Promise<{ status: number }>) =>
  p.then((r) => r.status).catch((e: any) => e?.response?.status ?? -1)

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    beforeAll(async () => {
      await runAllSeeds(getContainer())
    })

    describe("P3-03 Taiwan store, TWD, 5% tax-inclusive", () => {
      it("has exactly one region: Taiwan / TWD / tw", async () => {
        const token = await publishableToken(getContainer(), PUBLISHABLE_KEYS.official)
        const res = await api.get("/store/regions", {
          headers: { "x-publishable-api-key": token },
        })
        expect(res.status).toEqual(200)
        expect(res.data.regions).toHaveLength(1)
        const [region] = res.data.regions
        expect(region.name).toEqual(REGION_NAME)
        expect(region.currency_code).toEqual("twd")
        expect(region.countries.map((c: any) => c.iso_2)).toEqual(["tw"])
      })

      it("stores TWD as the only, tax-inclusive store currency", async () => {
        const [store] = await getContainer()
          .resolve(Modules.STORE)
          .listStores({}, { relations: ["supported_currencies"] })
        expect(store.supported_currencies).toHaveLength(1)
        expect(store.supported_currencies?.[0]).toMatchObject({
          currency_code: "twd",
          is_default: true,
        })
        const prefs = await getContainer()
          .resolve(Modules.PRICING)
          .listPricePreferences({ attribute: "currency_code", value: ["twd"] })
        expect(prefs).toHaveLength(1)
        expect(prefs[0].is_tax_inclusive).toBe(true)
      })

      it("has a tw tax region with a 5% default rate", async () => {
        const taxModule = getContainer().resolve(Modules.TAX)
        const regions = await taxModule.listTaxRegions({ country_code: "tw" })
        const parent = regions.filter((r) => !r.parent_id)
        expect(parent).toHaveLength(1)
        const rates = (
          await taxModule.listTaxRates({ tax_region_id: parent[0].id })
        ).filter((r) => r.is_default)
        expect(rates).toHaveLength(1)
        expect(Number(rates[0].rate)).toEqual(5)
        expect(rates[0].code).toEqual(TAX_RATE.code)
      })

      it("refuses items without stock; with stock, 2 x NT$1,150 totals exactly 2300 incl. 5% tax", async () => {
        const container = getContainer()
        const token = await publishableToken(container, PUBLISHABLE_KEYS.official)
        const headers = { "x-publishable-api-key": token }
        const {
          data: { regions },
        } = await api.get("/store/regions", { headers })
        const {
          data: { products },
        } = await api.get(`/store/products?handle=${catalog.products[0].handle}&fields=*variants`, {
          headers,
        })
        const variantId = products[0].variants[0].id

        const {
          data: { cart },
        } = await api.post("/store/carts", { region_id: regions[0].id }, { headers })

        // Seeded stock is 0 and backorders are off, so the add must be refused.
        const refused = await statusOf(
          api.post(
            `/store/carts/${cart.id}/line-items`,
            { variant_id: variantId, quantity: 2 },
            { headers }
          )
        )
        expect(refused).toEqual(400)

        await devAddTestStock({ container, args: [] } as any)
        const {
          data: { cart: updated },
        } = await api.post(
          `/store/carts/${cart.id}/line-items`,
          { variant_id: variantId, quantity: 2 },
          { headers }
        )

        expect(updated.total).toEqual(2300)
        expect(Number.isInteger(updated.total)).toBe(true)
        expect(updated.items[0].is_tax_inclusive).toBe(true)
        expect(updated.tax_total).toBeCloseTo(2300 - 2300 / 1.05, 6)
      })
    })

    describe("P3-04 catalog", () => {
      it("lists exactly the catalog handles at the catalog price, tax-inclusive", async () => {
        const token = await publishableToken(getContainer(), PUBLISHABLE_KEYS.official)
        const headers = { "x-publishable-api-key": token }
        const {
          data: { regions },
        } = await api.get("/store/regions", { headers })
        const res = await api.get(
          `/store/products?region_id=${regions[0].id}&fields=handle,*variants.calculated_price,*variants`,
          { headers }
        )
        const byHandle = new Map(res.data.products.map((p: any) => [p.handle, p]))
        expect([...byHandle.keys()].sort()).toEqual(
          catalog.products.map((p) => p.handle).sort()
        )
        for (const item of catalog.products) {
          const product: any = byHandle.get(item.handle)
          expect(product.variants).toHaveLength(1)
          expect(product.variants[0].sku).toEqual(item.sku)
          const price = product.variants[0].calculated_price
          expect(price.calculated_amount).toEqual(item.price)
          expect(price.currency_code).toEqual("twd")
          expect(price.is_calculated_price_tax_inclusive).toBe(true)
        }
      })

      it("stocks every catalog SKU at the warehouse with 0 on hand", async () => {
        const container = getContainer()
        const [location] = await container
          .resolve(Modules.STOCK_LOCATION)
          .listStockLocations({ name: STOCK_LOCATION_NAME })
        const { data: items } = await container
          .resolve(ContainerRegistrationKeys.QUERY)
          .graph({
            entity: "inventory_item",
            fields: ["sku", "location_levels.location_id", "location_levels.stocked_quantity"],
            filters: { sku: catalog.products.map((p) => p.sku) },
          })
        expect(items).toHaveLength(catalog.products.length)
        for (const item of items) {
          const level = (item.location_levels ?? []).find(
            (l: any) => l?.location_id === location.id
          )
          expect(level).toBeDefined()
          expect(Number(level?.stocked_quantity)).toEqual(0)
        }
      })
    })

    describe("P3-05 sales channels and publishable keys", () => {
      it("rejects store requests without a publishable key", async () => {
        const err = await api.get("/store/products").catch((e: any) => e)
        expect(err.response.status).toEqual(400)
        expect(err.response.data.type).toEqual("not_allowed")
      })

      it("scopes products to the key's sales channel", async () => {
        const container = getContainer()
        const [official] = await container
          .resolve(Modules.SALES_CHANNEL)
          .listSalesChannels({ name: SALES_CHANNELS.official.name })
        const [shippingProfile] = await container
          .resolve(Modules.FULFILLMENT)
          .listShippingProfiles({ type: "default" })
        await createProductsWorkflow(container).run({
          input: {
            products: [
              {
                title: "Official only",
                handle: "official-only-test",
                status: ProductStatus.PUBLISHED,
                shipping_profile_id: shippingProfile.id,
                options: [{ title: "x", values: ["x"] }],
                variants: [
                  { title: "x", options: { x: "x" }, prices: [{ currency_code: "twd", amount: 1 }] },
                ],
                sales_channels: [{ id: official.id }],
              },
            ],
          },
        })

        const handlesFor = async (title: string) => {
          const token = await publishableToken(container, title)
          const res = await api.get("/store/products?fields=handle", {
            headers: { "x-publishable-api-key": token },
          })
          return res.data.products.map((p: any) => p.handle)
        }
        const officialHandles = await handlesFor(PUBLISHABLE_KEYS.official)
        const groupBuyHandles = await handlesFor(PUBLISHABLE_KEYS.groupBuy)

        expect(officialHandles).toContain("official-only-test")
        expect(groupBuyHandles).not.toContain("official-only-test")
        for (const item of catalog.products) {
          expect(officialHandles).toContain(item.handle)
          expect(groupBuyHandles).toContain(item.handle)
        }
      })
    })

    describe("seed scripts are idempotent", () => {
      it("running every drn-* script again creates nothing new", async () => {
        const container = getContainer()
        const count = async () => {
          const [regions, channels, keys, products, locations, roles, taxRegions] =
            await Promise.all([
              container.resolve(Modules.REGION).listRegions({}),
              container.resolve(Modules.SALES_CHANNEL).listSalesChannels({}),
              container.resolve(Modules.API_KEY).listApiKeys({ type: "publishable" }),
              container.resolve(Modules.PRODUCT).listProducts({}),
              container.resolve(Modules.STOCK_LOCATION).listStockLocations({}),
              container.resolve<IRbacModuleService>(Modules.RBAC).listRbacRoles({}),
              container.resolve(Modules.TAX).listTaxRegions({}),
            ])
          return {
            regions: regions.length,
            channels: channels.length,
            keys: keys.length,
            products: products.length,
            locations: locations.length,
            roles: roles.length,
            taxRegions: taxRegions.length,
          }
        }
        const before = await count()
        await runAllSeeds(container)
        expect(await count()).toEqual(before)
      })
    })

    describe("P3-07 RBAC", () => {
      it("creates every staff role with all of its policies", async () => {
        const rbac = getContainer().resolve<IRbacModuleService>(Modules.RBAC)
        for (const def of ROLE_DEFINITIONS) {
          const [role] = await rbac.listRbacRoles({ name: def.name }, { relations: ["policies"] })
          expect(role).toBeDefined()
          const roleKeys = (role.policies ?? []).map((p: any) => p.key).sort()
          expect(roleKeys).toEqual([...new Set(def.policyKeys)].sort())
        }
      })

      it("content_editor can read products but not delete them", async () => {
        const container = getContainer()
        const headers = await adminHeadersFor(container, "editor@drn.test", "content_editor")
        const [product] = await container
          .resolve(Modules.PRODUCT)
          .listProducts({ handle: catalog.products[0].handle })
        expect(await statusOf(api.get("/admin/products", { headers }))).toEqual(200)
        expect(await statusOf(api.delete(`/admin/products/${product.id}`, { headers }))).toEqual(403)
      })

      it("operations cannot create products", async () => {
        const headers = await adminHeadersFor(getContainer(), "ops@drn.test", "operations")
        const status = await statusOf(
          api.post("/admin/products", { title: "nope", options: [{ title: "x", values: ["x"] }] }, { headers })
        )
        expect(status).toEqual(403)
      })

      it("a staff user with no role is denied on admin product routes", async () => {
        const headers = await adminHeadersFor(getContainer(), "norole@drn.test")
        expect(await statusOf(api.get("/admin/products", { headers }))).toEqual(403)
      })

      it("Super Admin can delete a product", async () => {
        const container = getContainer()
        const headers = await adminHeadersFor(container, "boss@drn.test", "Super Admin")
        const [product] = await container
          .resolve(Modules.PRODUCT)
          .listProducts({ handle: catalog.products[2].handle })
        expect(await statusOf(api.delete(`/admin/products/${product.id}`, { headers }))).toEqual(200)
      })
    })
  },
})
