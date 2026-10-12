// Names and constants shared by the drn-* migration scripts, dev scripts and tests.
// Changing a name here after a script has run on a database creates a second record
// on the next migration (scripts look records up by these names), so treat them as fixed.

export const STORE_NAME = "Dr.Nature"
export const CURRENCY_CODE = "twd"

export const REGION_NAME = "Taiwan"
export const REGION_COUNTRIES = ["tw"]

// Taiwan business tax (營業稅) is 5% and shelf prices include it.
export const TAX_RATE = { rate: 5, code: "TW-VAT-5", name: "營業稅 5%" }

export const SALES_CHANNELS = {
  official: { name: "Official Store", description: "dr.nature.smilelife.tw" },
  groupBuy: {
    name: "Group-buy",
    description: "Affiliate / group-buy stores (/s/<slug>)",
  },
} as const

export const PUBLISHABLE_KEYS = {
  official: "Official Store storefront",
  groupBuy: "Group-buy storefront",
} as const

export const STOCK_LOCATION_NAME = "Dr.Nature TW Warehouse"
export const FULFILLMENT_SET_NAME = "Dr.Nature TW delivery"
export const SERVICE_ZONE_NAME = "Taiwan"
