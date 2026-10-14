import { StatusBadge } from "@medusajs/ui"

const LOOK = {
  draft: { color: "grey", label: "草稿" },
  scheduled: { color: "orange", label: "排程" },
  published: { color: "green", label: "已發佈" },
} as const

export const VisibilityBadge = ({ visibility }: { visibility: keyof typeof LOOK }) => (
  <StatusBadge color={LOOK[visibility].color}>{LOOK[visibility].label}</StatusBadge>
)
