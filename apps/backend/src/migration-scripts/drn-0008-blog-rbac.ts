// [P6-01] Blog permissions for content editors on databases seeded before P6.
// drn-0004 creates missing roles only, so a content_editor role created earlier lacks the
// blog_* policies (src/policies/blog.ts). This script links the missing ones and, if the role's
// description is still the pre-P6 text, updates it. On a fresh database drn-0004 already gave
// the role every key and this script changes nothing. Super Admin (*:*) needs nothing; no other
// role is touched. Fails loudly (and stays pending) if a policy or the role is missing.
import type { MedusaContainer } from "@medusajs/framework"
import type { IRbacModuleService } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { createRbacRolePoliciesWorkflow } from "@medusajs/medusa/core-flows"
import { BLOG_POLICY_KEYS } from "../lib/blog/policies"
import { CONTENT_EDITOR_DESCRIPTION, CONTENT_EDITOR_DESCRIPTION_BEFORE_P6 } from "../lib/rbac-roles"

const BLOG_ROLE = "content_editor"

export default async function drnBlogRbac({ container }: { container: MedusaContainer }) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const rbac = container.resolve<IRbacModuleService>(Modules.RBAC)

  const policies = await rbac.listRbacPolicies({ key: BLOG_POLICY_KEYS })
  const idByKey = new Map(policies.map((p) => [p.key, p.id]))
  const missing = BLOG_POLICY_KEYS.filter((k) => !idByKey.has(k))
  if (missing.length) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `[drn-0008] RBAC policies missing: ${missing.join(", ")}`)
  }
  const [role] = await rbac.listRbacRoles({ name: BLOG_ROLE }, { relations: ["policies"] })
  if (!role) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `[drn-0008] role ${BLOG_ROLE} not found (drn-0004 must run first)`)
  }
  const held = new Set((role.policies ?? []).map((p) => p.key))
  const toLink = BLOG_POLICY_KEYS.filter((k) => !held.has(k))
  if (toLink.length) {
    // No actor_id: system seed, so the workflow skips the actor permission check.
    await createRbacRolePoliciesWorkflow(container).run({
      input: { policies: toLink.map((k) => ({ role_id: role.id, policy_id: idByKey.get(k) as string })) },
    })
    logger.info(`[drn-0008] ${BLOG_ROLE}: added ${toLink.join(", ")}`)
  }
  if (role.description === CONTENT_EDITOR_DESCRIPTION_BEFORE_P6) {
    // Module call, not updateRbacRolesWorkflow: that workflow passes name/metadata through as
    // undefined (core-flows 2.21.2 rbac/workflows/update-rbac-roles.js).
    await rbac.updateRbacRoles({ id: role.id, description: CONTENT_EDITOR_DESCRIPTION })
  }
}
