// A transport moves one HTTP request to the router and back.
// On Android it is the native RouterLink plugin (no CORS, certificate pinning);
// in a desktop browser during development it is fetch() through the Vite proxy.

export type HttpMethod = 'GET' | 'POST';

export interface HttpRequest {
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  /** Hex SHA-256 of the router's TLS certificate. Required for https URLs on Android. */
  pinSha256?: string;
}

export interface HttpResponse {
  status: number;
  body: string;
}

export interface CertificateInfo {
  sha256: string;
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
}

export type TransportErrorCode = 'network' | 'timeout' | 'tls' | 'pin-mismatch' | 'unsupported';

export class TransportError extends Error {
  readonly code: TransportErrorCode;

  constructor(code: TransportErrorCode, message: string) {
    super(message);
    this.name = 'TransportError';
    this.code = code;
  }
}

export interface Transport {
  readonly kind: 'native' | 'web' | 'test';
  request(req: HttpRequest): Promise<HttpResponse>;
  /** Reads the router certificate without sending credentials (trust-on-first-use). */
  probeCertificate(host: string, port: number): Promise<CertificateInfo>;
}

export function normalizeFingerprint(value: string): string {
  return value.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
}

export function formatFingerprint(value: string): string {
  const hex = normalizeFingerprint(value).toUpperCase();
  return hex.match(/.{1,2}/g)?.join(':') ?? '';
}
