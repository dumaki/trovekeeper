// Central redaction. Every log line and every error sent to the client passes
// through here, so a secret can never surface in output even if it ends up
// embedded in an upstream URL or error message.

/** Replace any occurrence of the given secret values with a fixed marker. */
export function redact(text: string, secrets: (string | undefined)[]): string {
  let out = text
  for (const s of secrets) {
    if (s && s.length >= 6) out = out.split(s).join('••••redacted••••')
  }
  // Belt-and-suspenders: scrub query params that commonly carry keys.
  out = out.replace(/([?&](?:key|token|api[_-]?key)=)[^&\s]+/gi, '$1••••redacted••••')
  return out
}

/** A non-revealing status string for a secret — never exposes any character. */
export function secretStatus(value: string | undefined): 'set' | 'missing' {
  return value ? 'set' : 'missing'
}
