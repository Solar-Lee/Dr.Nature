// [LINE-04] In-process memory of recent webhookEventIds. With redelivery on, LINE re-sends an
// event it could not deliver, under the same webhookEventId (developers.line.biz
// receiving-messages; webhook.yml deliveryContext.isRedelivery). One server process receives
// the webhook (the worker serves no HTTP), so a bounded Map in insertion order is enough; a
// restart forgets the ids, which at worst answers a redelivered question twice.
export class RecentIds {
  private readonly ids = new Map<string, true>()

  constructor(private readonly max = 5000) {}

  /** True the first time an id is seen, false while it is still remembered. */
  firstSeen(id: string): boolean {
    if (this.ids.has(id)) {
      // Refresh: a repeated id stays remembered longer than ids seen once.
      this.ids.delete(id)
      this.ids.set(id, true)
      return false
    }
    this.ids.set(id, true)
    if (this.ids.size > this.max) {
      const oldest = this.ids.keys().next().value
      if (oldest !== undefined) {
        this.ids.delete(oldest)
      }
    }
    return true
  }

  get size(): number {
    return this.ids.size
  }
}
