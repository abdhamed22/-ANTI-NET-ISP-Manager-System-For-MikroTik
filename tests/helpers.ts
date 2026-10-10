import { startMock, type MockState } from '../mock/server.mjs';
import { RouterClient } from '../src/core/routeros/client.ts';
import { TransportError, type HttpRequest, type HttpResponse, type Transport } from '../src/core/routeros/transport.ts';

/** Talks to the mock server directly with Node's fetch. */
export class NodeTransport implements Transport {
  readonly kind = 'test' as const;
  async request(req: HttpRequest): Promise<HttpResponse> {
    try {
      const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body, signal: AbortSignal.timeout(req.timeoutMs) });
      return { status: res.status, body: await res.text() };
    } catch (e) {
      throw new TransportError('network', String(e));
    }
  }
  async probeCertificate() {
    return { sha256: '0'.repeat(64), subject: '', issuer: '', validFrom: '', validTo: '' };
  }
}

export interface Mock {
  state: MockState;
  client(user?: string, pass?: string): RouterClient;
  close(): Promise<void>;
}

export async function mock(): Promise<Mock> {
  const { server, state, port } = await startMock(0);
  const transport = new NodeTransport();
  return {
    state,
    client: (user = 'admin', pass = 'admin123') =>
      new RouterClient(transport, { host: '127.0.0.1', port, secure: false }, { username: user, password: pass }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
