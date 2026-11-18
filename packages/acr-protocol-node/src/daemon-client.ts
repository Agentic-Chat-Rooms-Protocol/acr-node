import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_LOCAL_URL,
  REST_TIMEOUT_MS,
  assertNoRedirectResponse,
  resolveLocalDaemonUrl,
} from './mcpendpoint.js';

export interface AcrDaemonClientConfig {
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
}

export async function loadDaemonApiToken(explicitToken?: string): Promise<string | undefined> {
  const direct = explicitToken?.trim();
  if (direct) {
    return direct;
  }

  const envToken = process.env.ACR_API_TOKEN?.trim();
  if (envToken) {
    return envToken;
  }

  try {
    const tokenPath = join(homedir(), '.acr', 'api-token');
    const raw = (await readFile(tokenPath, 'utf8')).trim();
    if (raw) {
      return raw;
    }
  } catch {
    // Missing or unreadable ~/.acr/api-token is acceptable when auth is unconfigured.
  }

  return undefined;
}

export class AcrDaemonClient {
  public readonly baseUrl: string;
  private readonly explicitToken?: string;
  private readonly timeoutMs: number;

  constructor(config: AcrDaemonClientConfig = {}) {
    this.baseUrl = config.baseUrl
      ? resolveLocalDaemonUrl(config.baseUrl)
      : resolveLocalDaemonUrl();
    this.explicitToken = config.token;
    this.timeoutMs = config.timeoutMs ?? REST_TIMEOUT_MS;
  }

  public async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = `${this.baseUrl || DEFAULT_LOCAL_URL}${normalizedPath}`;
    const headers = new Headers(init.headers ?? {});
    headers.set('Accept', 'application/json');
    if (init.body && typeof init.body === 'string' && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (!headers.has('Authorization')) {
      const token = await loadDaemonApiToken(this.explicitToken);
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        headers,
        redirect: 'manual',
        signal: controller.signal,
      });
      clearTimeout(timer);
      assertNoRedirectResponse(res);
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`ACR Daemon HTTP ${res.status}: ${errText || res.statusText}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
