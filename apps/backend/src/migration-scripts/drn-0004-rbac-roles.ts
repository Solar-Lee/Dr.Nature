// [P3-07] Staff roles (operations, support, content_editor, finance) built from the
// built-in RBAC policies. Users are assigned roles in the admin (Settings > Roles) or
// via invites; a user's new role takes effect at their next login.
//
// Fails loudly (and stays pending for the next migrate) if any policy key is missing,
// e.g. if the RBAC module is not loaded. Existing roles are left untouched.
import type { MedusaContainer } from "@medusajs/framework"
import type { IRbacModuleService } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { createRbacRolesWorkflow } from "@medusajs/medusa/core-flows"
import { ROLE_DEFINITIONS } from "../lib/rbac-roles"

export default async function drnRbacRoles({
  container,
}: {
  container: MedusaContainer
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const rbac = container.resolve<IRbacModuleService>(Modules.RBAC)

  const wantedKeys = Array.from(new Set(ROLE_DEFINITIONS.flatMap((r) => r.policyKeys)))
  const policies = await rbac.listRbacPolicies({ key: wantedKeys })
  const idByKey = new Map(policies.map((p) => [p.key, p.id]))
  const missing = wantedKeys.filter((k) => !idByKey.has(k))
  if (missing.length) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `[drn-0004] RBAC policies missing: ${missing.join(", ")}`)
  }

  const toCreate: { name: string; description: string; policy_ids: string[] }[] = []
  for (const def of ROLE_DEFINITIONS) {
    const existing = await rbac.listRbacRoles({ name: def.name })
    if (existing.length) {
      continue
    }
    toCreate.push({
      name: def.name,
      description: def.description,
      policy_ids: def.policyKeys.map((k) => idByKey.get(k) as string),
    })
  }
  if (!toCreate.length) {
    return
  }
  // No actor_id: system seed, so the workflow skips the actor permission check.
  const { result } = await createRbacRolesWorkflow(container).run({
    input: { roles: toCreate },
  })
  logger.info(`[drn-0004] created roles: ${result.map((r) => r.name).join(", ")}`)
}
