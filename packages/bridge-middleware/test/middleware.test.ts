import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { BridgeIdentity } from '@acr/platform-bridge-core';
import {
  createBridgeExpressMiddleware,
  createBridgeFastifyHook,
} from '../src/express.js';

describe('acr-node/bridge-middleware: Express & Fastify Verification Middleware', () => {
  const SLACK_SECRET = 'slack_secret_123';
  const WA_VERIFY_TOKEN = 'wa_verify_token_456';
  const WA_APP_SECRET = 'wa_app_secret_789';

  // RSA keypair for Teams JWKS testing
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwkExport = publicKey.export({ format: 'jwk' }) as { n: string; e: string };
  const TEAMS_KID = 'teams-kid-2026';
  const teamsJwksKey = {
    kty: 'RSA' as const,
    kid: TEAMS_KID,
    use: 'sig' as const,
    alg: 'RS256' as const,
    n: jwkExport.n,
    e: jwkExport.e,
  };

  function createTeamsToken(): string {
    const header = { alg: 'RS256', kid: TEAMS_KID };
    const nowSec = Math.floor(Date.now() / 1000);
    const payload = {
      iss: 'https://api.botframework.com',
      aud: 'acr-app',
      exp: nowSec + 3600,
    };
    const hB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const pB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.sign('RSA-SHA256', Buffer.from(`${hB64}.${pB64}`), privateKey).toString('base64url');
    return `${hB64}.${pB64}.${sig}`;
  }

  function mockExpress() {
    let statusCode = 200;
    let sentData: any = null;
    const res: any = {
      status(c: number) {
        statusCode = c;
        return res;
      },
      json(d: any) {
        sentData = d;
      },
      send(d: any) {
        sentData = d;
      },
    };
    return {
      res,
      getStatus: () => statusCode,
      getData: () => sentData,
    };
  }

  it('should authenticate Slack webhook in Express middleware and attach acrBridgeEnvelope', async () => {
    const middleware = createBridgeExpressMiddleware({
      slackSigningSecret: SLACK_SECRET,
    });

    const body = JSON.stringify({
      type: 'event_callback',
      event: {
        channel: 'C100',
        ts: '1728000000.123',
        user: 'U100',
        text: 'Deploy pod email test@mesh.org',
      },
    });
    const ts = Math.floor(Date.now() / 1000);
    const sig = `v0=${crypto.createHmac('sha256', SLACK_SECRET).update(`v0:${ts}:${body}`).digest('hex')}`;

    const req: any = {
      path: '/api/v1/bridge/slack',
      headers: {
        'x-slack-signature': sig,
        'x-slack-request-timestamp': String(ts),
      },
      body,
    };

    const mock = mockExpress();
    let nextCalled = false;
    await middleware(req, mock.res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.ok(req.acrBridgeEnvelope);
    assert.equal(req.acrBridgeEnvelope.platform, 'slack');
    assert.equal(req.acrBridgeEnvelope.content, 'Deploy pod email <EMAIL>');
    assert.equal(BridgeIdentity.verify(req.acrBridgeEnvelope), true);
  });

  it('should reject Slack webhook with invalid signature with 401', async () => {
    const middleware = createBridgeExpressMiddleware({
      slackSigningSecret: SLACK_SECRET,
    });

    const req: any = {
      path: '/api/v1/bridge/slack',
      headers: {
        'x-slack-signature': 'v0=bad_signature',
        'x-slack-request-timestamp': String(Math.floor(Date.now() / 1000)),
      },
      body: '{}',
    };

    const mock = mockExpress();
    let nextCalled = false;
    await middleware(req, mock.res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(mock.getStatus(), 401);
  });

  it('should respond to WhatsApp GET verification challenge', async () => {
    const middleware = createBridgeExpressMiddleware({
      whatsAppVerifyToken: WA_VERIFY_TOKEN,
      whatsAppAppSecret: WA_APP_SECRET,
    });

    const req: any = {
      method: 'GET',
      path: '/webhook/whatsapp',
      query: {
        'hub.mode': 'subscribe',
        'hub.verify_token': WA_VERIFY_TOKEN,
        'hub.challenge': 'challenge_12345',
      },
      headers: {},
    };

    const mock = mockExpress();
    let nextCalled = false;
    await middleware(req, mock.res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(mock.getStatus(), 200);
    assert.equal(mock.getData(), 'challenge_12345');
  });

  it('should authenticate Teams webhook via dynamic JWKS and attach acrBridgeEnvelope', async () => {
    const middleware = createBridgeExpressMiddleware({
      teamsAppId: 'acr-app',
      teamsInitialKeys: [teamsJwksKey],
    });

    const token = createTeamsToken();
    const body = {
      id: 'activity_teams_99',
      channelId: 'teams_ch',
      from: { id: 'usr_teams', name: 'Lt Cmdr Geordi' },
      text: 'Warp core diagnostics card 4111111111111111',
    };

    const req: any = {
      path: '/api/v1/bridge/teams',
      headers: {
        authorization: `Bearer ${token}`,
      },
      body,
    };

    const mock = mockExpress();
    let nextCalled = false;
    await middleware(req, mock.res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.ok(req.acrBridgeEnvelope);
    assert.equal(req.acrBridgeEnvelope.platform, 'teams');
    assert.equal(req.acrBridgeEnvelope.content, 'Warp core diagnostics card <CARD>');
    assert.equal(BridgeIdentity.verify(req.acrBridgeEnvelope), true);
  });

  it('should execute Fastify hook seamlessly', async () => {
    const hook = createBridgeFastifyHook({
      slackSigningSecret: SLACK_SECRET,
    });

    const body = JSON.stringify({
      type: 'event_callback',
      event: {
        channel: 'C200',
        ts: '1728000000.456',
        user: 'U200',
        text: 'Fastify request verified',
      },
    });
    const ts = Math.floor(Date.now() / 1000);
    const sig = `v0=${crypto.createHmac('sha256', SLACK_SECRET).update(`v0:${ts}:${body}`).digest('hex')}`;

    const request: any = {
      url: '/slack/events',
      headers: {
        'x-slack-signature': sig,
        'x-slack-request-timestamp': String(ts),
      },
      body,
    };

    let replyCode = 200;
    const reply: any = {
      code(c: number) {
        replyCode = c;
        return reply;
      },
      send() {},
    };

    await hook(request, reply);
    assert.ok(request.acrBridgeEnvelope);
    assert.equal(request.acrBridgeEnvelope.platform, 'slack');
    assert.equal(BridgeIdentity.verify(request.acrBridgeEnvelope), true);
  });
});
