export const REMOTE_MCP_URL = 'https://mcp.agentchatrooms.dev/mcp';
export const DEFAULT_LOCAL_PORT = 20443;
export const DEFAULT_LOCAL_URL = `http://127.0.0.1:${DEFAULT_LOCAL_PORT}`;
export const REST_TIMEOUT_MS = 10_000;

export const CLERK_OAUTH_CLIENT_SCOPES = Object.freeze(['profile', 'email'] as const);
export const REQUIRED_REMOTE_SCOPES = Object.freeze(['acr:rooms', 'acr:cloud:pro'] as const);

export type EndpointMode = 'local' | 'remote';

export interface EndpointResolution {
  mode: EndpointMode;
  url: string;
  reason: string;
}

export interface ResolveEndpointOptions {
  override?: string;
  grantedScopes?: readonly string[];
  localUrl?: string;
}

export class McpEndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpEndpointError';
  }
}

function hasControlOrWhitespace(raw: string): boolean {
  return /[\s\u0000-\u001f\u007f]/.test(raw);
}

export function validateRemote(raw: string): string {
  if (typeof raw !== 'string' || raw.length === 0 || hasControlOrWhitespace(raw)) {
    throw new McpEndpointError('remote: invalid or empty URL');
  }
  const lower = raw.toLowerCase();
  if (!lower.startsWith('https://')) {
    throw new McpEndpointError('remote: scheme must be https');
  }
  if (raw.includes('?') || raw.includes('#') || raw.includes('\\')) {
    throw new McpEndpointError('remote: query, fragment, or backslash not allowed');
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new McpEndpointError('remote: malformed URL');
  }

  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') {
    throw new McpEndpointError('remote: scheme or userinfo not allowed');
  }

  const afterScheme = raw.slice('https://'.length);
  const slashIdx = afterScheme.indexOf('/');
  const rawAuthority = slashIdx === -1 ? afterScheme : afterScheme.slice(0, slashIdx);
  const rawPath = slashIdx === -1 ? '' : afterScheme.slice(slashIdx);

  if (rawAuthority.includes('@')) {
    throw new McpEndpointError('remote: userinfo not allowed');
  }

  const colonIdx = rawAuthority.indexOf(':');
  const rawHost = (colonIdx === -1 ? rawAuthority : rawAuthority.slice(0, colonIdx)).toLowerCase();
  const rawPort = colonIdx === -1 ? '' : rawAuthority.slice(colonIdx + 1);

  if (rawHost !== 'mcp.agentchatrooms.dev' || parsed.hostname.toLowerCase() !== 'mcp.agentchatrooms.dev') {
    throw new McpEndpointError('remote: host not allowlisted');
  }

  if (rawPort !== '' && rawPort !== '443') {
    throw new McpEndpointError('remote: port must be empty or 443');
  }

  if (rawPath !== '/mcp' || parsed.pathname !== '/mcp') {
    throw new McpEndpointError('remote: path must be exactly /mcp');
  }

  return REMOTE_MCP_URL;
}

export function validateLocal(raw: string): string {
  if (typeof raw !== 'string' || raw.length === 0 || hasControlOrWhitespace(raw)) {
    throw new McpEndpointError('local: invalid or empty URL');
  }
  const lower = raw.toLowerCase();
  if (!lower.startsWith('http://')) {
    throw new McpEndpointError('local: scheme must be http');
  }
  if (raw.includes('?') || raw.includes('#') || raw.includes('\\')) {
    throw new McpEndpointError('local: query, fragment, or backslash not allowed');
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new McpEndpointError('local: malformed URL');
  }

  if (parsed.protocol !== 'http:' || parsed.username !== '' || parsed.password !== '') {
    throw new McpEndpointError('local: scheme or userinfo not allowed');
  }

  const afterScheme = raw.slice('http://'.length);
  const slashIdx = afterScheme.indexOf('/');
  const rawAuthority = slashIdx === -1 ? afterScheme : afterScheme.slice(0, slashIdx);
  const rawPath = slashIdx === -1 ? '' : afterScheme.slice(slashIdx);

  if (rawAuthority.includes('@')) {
    throw new McpEndpointError('local: userinfo not allowed');
  }
  if (rawPath !== '' && rawPath !== '/') {
    throw new McpEndpointError('local: path must be empty or /');
  }

  let rawHost: string;
  let rawPort = '';

  if (rawAuthority.startsWith('[')) {
    const closeIdx = rawAuthority.indexOf(']');
    if (closeIdx === -1) {
      throw new McpEndpointError('local: malformed IPv6 host');
    }
    rawHost = rawAuthority.slice(1, closeIdx);
    const rest = rawAuthority.slice(closeIdx + 1);
    if (rest !== '') {
      if (!rest.startsWith(':')) {
        throw new McpEndpointError('local: malformed IPv6 authority');
      }
      rawPort = rest.slice(1);
    }
  } else {
    const parts = rawAuthority.split(':');
    if (parts.length > 2) {
      throw new McpEndpointError('local: malformed host/port');
    }
    rawHost = parts[0];
    rawPort = parts[1] ?? '';
  }

  const hostLower = rawHost.toLowerCase();
  let normalizedHost: string;
  if (hostLower === 'localhost' || hostLower === '127.0.0.1') {
    normalizedHost = '127.0.0.1';
  } else if (hostLower === '::1') {
    normalizedHost = '[::1]';
  } else {
    throw new McpEndpointError('local: host must be localhost, 127.0.0.1, or ::1');
  }

  let port = DEFAULT_LOCAL_PORT;
  if (rawPort !== '') {
    if (!/^\d+$/.test(rawPort)) {
      throw new McpEndpointError('local: port must be numeric 1024-65535');
    }
    const n = Number(rawPort);
    if (!Number.isInteger(n) || n < 1024 || n > 65535) {
      throw new McpEndpointError('local: port must be 1024-65535');
    }
    port = n;
  }

  return `http://${normalizedHost}:${port}`;
}

export function resolveEndpoint(options: ResolveEndpointOptions = {}): EndpointResolution {
  const local = validateLocal(options.localUrl ?? DEFAULT_LOCAL_URL);
  const override = options.override ?? '';

  if (override === 'local') {
    return { mode: 'local', url: local, reason: 'explicit override' };
  }
  if (override === 'remote') {
    return { mode: 'remote', url: REMOTE_MCP_URL, reason: 'explicit override' };
  }
  if (override !== '') {
    throw new McpEndpointError('override must be local or remote');
  }

  const scopeSet = new Set(options.grantedScopes ?? []);
  const hasAllRequired = REQUIRED_REMOTE_SCOPES.every((s) => scopeSet.has(s));
  if (hasAllRequired) {
    return {
      mode: 'remote',
      url: REMOTE_MCP_URL,
      reason: 'granted scopes include acr:cloud:pro',
    };
  }

  return { mode: 'local', url: local, reason: 'no paid scope; default' };
}

export function resolveLocalDaemonUrl(explicitUrl?: string): string {
  const envUrl = process.env.ACR_DAEMON_URL?.trim();
  return validateLocal(explicitUrl || envUrl || DEFAULT_LOCAL_URL);
}

export function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

export function assertNoRedirectResponse(response: Pick<Response, 'status' | 'type'>): void {
  if (response.type === 'opaqueredirect' || isRedirectStatus(response.status)) {
    throw new McpEndpointError('mcpendpoint: redirects are not followed');
  }
}
