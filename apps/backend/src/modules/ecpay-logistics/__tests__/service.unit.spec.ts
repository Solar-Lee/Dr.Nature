import { declaredValue } from "../service"

// Order lines as Medusa 2.21.2 create-fulfillment loads them ("items.*", tax-inclusive totals).
const lines = [
  { id: "ordli_a", total: 2300, quantity: 2, variant: { inventory_items: [{ required_quantity: 1, inventory: { id: "iitem_a" } }] } },
  { id: "ordli_b", total: 1035, quantity: 1, detail: { quantity: 1 }, variant: { inventory_items: [{ required_quantity: 3, inventory: { id: "iitem_b" } }] } },
]

describe("declaredValue (ECPay GoodsAmount of one shipment)", () => {
  it("is the paid price of the fulfilled quantities, not the whole order", () => {
    expect(declaredValue([{ line_item_id: "ordli_a", inventory_item_id: "iitem_a", quantity: 2 }], lines)).toEqual(2300)
    expect(declaredValue([{ line_item_id: "ordli_a", inventory_item_id: "iitem_a", quantity: 1 }], lines)).toEqual(1150)
  })

  it("converts inventory-item quantities back to line units (kits)", () => {
    // 1 unit of line b = 3 inventory units.
    expect(declaredValue([{ line_item_id: "ordli_b", inventory_item_id: "iitem_b", quantity: 3 }], lines)).toEqual(1035)
  })

  it("adds several lines", () => {
    expect(
      declaredValue(
        [
          { line_item_id: "ordli_a", inventory_item_id: "iitem_a", quantity: 2 },
          { line_item_id: "ordli_b", inventory_item_id: "iitem_b", quantity: 3 },
        ],
        lines
      )
    ).toEqual(3335)
  })

  it("refuses items that are not on the order or lines without totals", () => {
    expect(() => declaredValue([{ line_item_id: "ordli_x", quantity: 1 }], lines)).toThrow()
    expect(() => declaredValue([{ line_item_id: "ordli_a", quantity: 1 }], [{ id: "ordli_a", quantity: 1 }])).toThrow()
  })
})
