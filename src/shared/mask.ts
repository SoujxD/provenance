// Masking of sensitive values (SSNs, bank and account numbers, IP PINs, signature PINs, license numbers).
// The server applies this to every response for viewers without clearance, and by default for everyone:
// cleared staff reveal a single value through /api/unmask, which writes a view-log event.

export type SensitiveValue = { value: string; kind: 'ssn' | 'account' | 'pin' | 'license' | 'iban'; ref: string };

export function maskValue(s: SensitiveValue | { value: string; kind: string }): string {
  const v = s.value;
  const last4 = v.replace(/[^0-9A-Za-z]/g, '').slice(-4);
  switch (s.kind) {
    case 'ssn':
      return `•••-••-${last4}`;
    case 'iban':
      return `${v.slice(0, 4)} •••• ${last4}`;
    case 'pin':
      return '•'.repeat(Math.min(v.length, 6));
    default:
      return `••••${last4}`;
  }
}

const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;

export function buildMasker(values: SensitiveValue[]): (s: string) => string {
  const sorted = [...values].sort((a, b) => b.value.length - a.value.length);
  const map = new Map(sorted.map((v) => [v.value, maskValue(v)]));
  const esc = sorted.map((v) => v.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = esc.length ? new RegExp(`(?<![0-9])(${esc.join('|')})(?![0-9])`, 'g') : null;
  return (s: string) => {
    let out = re ? s.replace(re, (m) => map.get(m) ?? m) : s;
    // Any other SSN-shaped string (for example a mistyped SSN) is masked too.
    out = out.replace(SSN_RE, (m) => `•••-••-${m.slice(-4)}`);
    return out;
  };
}

export function maskDeep<T>(obj: T, mask: (s: string) => string): T {
  if (typeof obj === 'string') return mask(obj) as unknown as T;
  if (Array.isArray(obj)) return obj.map((x) => maskDeep(x, mask)) as unknown as T;
  if (obj && typeof obj === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(obj as any)) out[k] = maskDeep(v, mask);
    return out;
  }
  return obj;
}
