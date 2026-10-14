// File module options (P12-15, deployment review D9). Uploads (product images, Admin uploads)
// are served by Medusa's local file provider from <cwd>/static, which in the image is
// /app/.medusa/server/static (a named volume, drn_uploads, in infra/docker-compose.prod.yml).
// The provider's default public URL is http://localhost:9000/static (file-local
// local-file.js:60 in 2.21.2), which is wrong behind a public host name, so it is derived from
// MEDUSA_BACKEND_URL. Production refuses to boot without that URL; outside production the
// module keeps Medusa's defaults so local dev and tests need no extra variables.
import { MedusaError } from "@medusajs/framework/utils"

export const LOCAL_FILE_PROVIDER_ID = "local"

export function fileStaticUrl(backendUrl: string): string {
  return `${backendUrl.replace(/\/+$/, "")}/static`
}

export function fileModuleFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const backendUrl = env.MEDUSA_BACKEND_URL
  if (!backendUrl) {
    if (env.NODE_ENV === "production") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "MEDUSA_BACKEND_URL is required in production (public URL of uploaded files)"
      )
    }
    return []
  }
  return [
    {
      resolve: "@medusajs/medusa/file",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/file-local",
            id: LOCAL_FILE_PROVIDER_ID,
            options: { backend_url: fileStaticUrl(backendUrl) },
          },
        ],
      },
    },
  ]
}
