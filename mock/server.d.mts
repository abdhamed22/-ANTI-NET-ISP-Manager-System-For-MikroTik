import type { Server } from 'node:http';

export interface MockState {
  menus: Record<string, Array<Record<string, string>>>;
  passwords: Map<string, string>;
  requests: Array<{ method: string; path: string; body: string }>;
}

export function createState(): MockState;
export function startMock(port?: number, state?: MockState): Promise<{ server: Server; state: MockState; port: number }>;
