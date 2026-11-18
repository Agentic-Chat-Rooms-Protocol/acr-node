import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  AcrDaemonClient,
  AcrProtocolNode,
  CLERK_OAUTH_CLIENT_SCOPES,
  DEFAULT_LOCAL_URL,
  McpEndpointError,
  REMOTE_MCP_URL,
  loadDaemonApiToken,
  resolveEndpoint,
  validateLocal,
  validateRemote,
} from '../dist/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'endpoint-vectors.json'), 'utf8')
);

function startMockServer(handler: http.RequestListener): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

test('AcrDaemonClient & AcrProtocolNode default to literal http://127.0.0.1:20443', () => {
  const prev = process.env.ACR_DAEMON_URL;
  try {
    delete process.env.ACR_DAEMON_URL;
    assert.equal(DEFAULT_LOCAL_URL, 'http://127.0.0.1:20443');
    const client = new AcrDaemonClient();
    assert.equal(client.baseUrl, 'http://127.0.0.1:20443');

    const node = new AcrProtocolNode({
      localAgentIdentity: {
        did: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
        publicKeyHex: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        capabilities: ['chat.message.send'],
      },
      irohPublicKey: 'iroh-pubkey-node-alpha',
    });
    assert.equal(node.daemonUrl, 'http://127.0.0.1:20443');
  } finally {
    if (prev === undefined) delete process.env.ACR_DAEMON_URL;
    else process.env.ACR_DAEMON_URL = prev;
  }
});

test('AcrDaemonClient sends Authorization: Bearer from ACR_API_TOKEN env var', async () => {
  const seenAuth: Array<string | undefined> = [];
  const { server, url } = await startMockServer((req, res) => {
    seenAuth.push(req.headers.authorization);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  });

  const prev = process.env.ACR_API_TOKEN;
  try {
    process.env.ACR_API_TOKEN = 'node-env-token-abc';
    const client = new AcrDaemonClient({ baseUrl: url });
    const data = await client.request<{ status: string }>('/api/v1/health');
    assert.equal(data.status, 'ok');
    assert.equal(seenAuth[0], 'Bearer node-env-token-abc');
  } finally {
    if (prev === undefined) delete process.env.ACR_API_TOKEN;
    else process.env.ACR_API_TOKEN = prev;
    server.close();
  }
});

test('loadDaemonApiToken falls back to ~/.acr/api-token and sends Bearer header', async () => {
  const tempHome = mkdtempSync(join(tmpdir(), 'acr-node-home-'));
  const acrDir = join(tempHome, '.acr');
  mkdirSync(acrDir, { recursive: true });
  writeFileSync(join(acrDir, 'api-token'), '  node-file-token-xyz \n', 'utf8');

  const seenAuth: Array<string | undefined> = [];
  const { server, url } = await startMockServer((req, res) => {
    seenAuth.push(req.headers.authorization);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });

  const prevToken = process.env.ACR_API_TOKEN;
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  try {
    delete process.env.ACR_API_TOKEN;
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;

    assert.equal(await loadDaemonApiToken(), 'node-file-token-xyz');
    const client = new AcrDaemonClient({ baseUrl: url });
    await client.request('/api/v1/rooms');
    assert.equal(seenAuth[0], 'Bearer node-file-token-xyz');
  } finally {
    if (prevToken === undefined) delete process.env.ACR_API_TOKEN;
    else process.env.ACR_API_TOKEN = prevToken;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;
    server.close();
    rmSync(tempHome, { recursive: true, force: true });
  }
});

test('AcrDaemonClient rejects 3xx redirects without following or leaking Bearer token', async () => {
  let targetHit = false;
  const { server: targetServer, url: targetUrl } = await startMockServer((_req, res) => {
    targetHit = true;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  const { server: redirectServer, url: redirectUrl } = await startMockServer((_req, res) => {
    res.writeHead(302, { Location: `${targetUrl}/steal` });
    res.end();
  });

  try {
    const client = new AcrDaemonClient({ baseUrl: redirectUrl, token: 'secret-token' });
    await assert.rejects(() => client.request('/api/v1/health'), /redirects are not followed/);
    assert.equal(targetHit, false);
  } finally {
    redirectServer.close();
    targetServer.close();
  }
});

test('mcpendpoint matches endpoint-vectors.json and safe Clerk OAuth scopes', () => {
  assert.deepEqual([...CLERK_OAUTH_CLIENT_SCOPES], ['profile', 'email']);
  for (const u of vectors.remote.accept) {
    assert.equal(validateRemote(u), REMOTE_MCP_URL);
  }
  for (const u of vectors.remote.reject) {
    assert.throws(() => validateRemote(u), McpEndpointError);
  }
  for (const entry of vectors.local.accept) {
    assert.equal(validateLocal(entry.input), entry.expected);
  }
  for (const u of vectors.local.reject) {
    assert.throws(() => validateLocal(u), McpEndpointError);
  }
  for (const row of vectors.resolve) {
    if (row.expectError) {
      assert.throws(
        () => resolveEndpoint({ override: row.override, grantedScopes: row.scopes, localUrl: row.localUrl }),
        McpEndpointError
      );
    } else {
      const res = resolveEndpoint({ override: row.override, grantedScopes: row.scopes, localUrl: row.localUrl });
      assert.equal(res.mode, row.mode);
      assert.equal(res.url, row.url);
    }
  }
});
