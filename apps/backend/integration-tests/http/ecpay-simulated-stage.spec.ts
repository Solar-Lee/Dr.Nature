// P4-04: with ECPAY_ACCEPT_SIMULATED_PAYMENTS=true (stage only) a vendor back-office
// simulated payment completes an ATM order end to end. This is the setting used for the
// real-stage acceptance run. The flag is set before the app boots (medusa-config reads it
// at load; the routes read it per request) and restored afterwards so it cannot leak into
// other spec files run in the same process.
//
// Run: cd apps/backend && ../../infra/test-env.sh pnpm run test:integration:http
const previousFlag = process.env.ECPAY_ACCEPT_SIMULATED_PAYMENTS
process.env.ECPAY_ACCEPT_SIMULATED_PAYMENTS = "true"

import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import devAddTestStock from "../../src/scripts/dev-add-test-stock"
import { addTestShipping, makeCheckoutHelpers, runAllSeeds } from "../helpers/ecpay-checkout"

jest.setTimeout(180 * 1000)

afterAll(() => {
  if (previousFlag === undefined) {
    delete process.env.ECPAY_ACCEPT_SIMULATED_PAYMENTS
  } else {
    process.env.ECPAY_ACCEPT_SIMULATED_PAYMENTS = previousFlag
  }
})

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    beforeAll(async () => {
      const container = getContainer()
      await runAllSeeds(container)
      await addTestShipping(container)
      await devAddTestStock({ container, args: [] } as any)
    })

    const { checkout, postNotice, postPaymentInfo, codeIssuedNotice, capturedPayments, paidNotice } =
      makeCheckoutHelpers({ api, getContainer })

    it("a simulated ATM payment captures the order when the stage flag is on", async () => {
      const { session, sessionData } = await checkout({ choosePayment: "ATM" })
      expect((await postPaymentInfo(codeIssuedNotice(sessionData, session, "ATM"))).data).toEqual("1|OK")
      const res = await postNotice(paidNotice(sessionData, session, { PaymentType: "ATM_FIRST", SimulatePaid: "1" }))
      expect(res.data).toEqual("1|OK")
      expect(await capturedPayments(session.id)).toHaveLength(1)
    })
  },
})
