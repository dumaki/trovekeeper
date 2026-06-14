// Provider/secret config, sourced from providers.json so the server, setup
// script, and doctor all agree on what credentials exist and which are secret.
import providersJson from '../providers.json' with { type: 'json' }

export interface EnvKeyMeta {
  key: string
  required: boolean
  secret: boolean
  hint: string
}
export interface ProviderMeta {
  id: string
  label: string
  env: EnvKeyMeta[]
}

export const PROVIDERS: ProviderMeta[] =
  (providersJson as { providers: ProviderMeta[] }).providers

/** True when all required env vars for a provider are present. */
export function providerConfigured(p: ProviderMeta): boolean {
  return p.env.filter((e) => e.required).every((e) => Boolean(process.env[e.key]))
}

/** All currently-set secret values — fed to redact() so they can be scrubbed. */
export function activeSecrets(): string[] {
  return PROVIDERS.flatMap((p) =>
    p.env.filter((e) => e.secret).map((e) => process.env[e.key]),
  ).filter((v): v is string => Boolean(v))
}

/** Public, secret-free snapshot for /api/health and the frontend banner. */
export function healthSnapshot() {
  return {
    providers: PROVIDERS.map((p) => ({
      id: p.id,
      label: p.label,
      configured: providerConfigured(p),
    })),
  }
}
