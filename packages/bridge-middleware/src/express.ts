import { BridgeIdentity, InboundBridgeEnvelope, PiiScrubber, SeenSet } from '@acr/platform-bridge-core';
import { SlackInboundHandler } from '@acr/bridge-slack';
import { TeamsInboundHandler } from '@acr/bridge-teams';
import crypto from 'node:crypto';

export type SupportedPlatform = 'slack' | 'teams' | 'whatsapp' | 'auto';

export interface BridgeMiddlewareOptions {
  platform?: SupportedPlatform;
  slackSigningSecret?: string;
  teamsAppId?: string;
  teamsExpectedIssuer?: string;
  teamsJwksUrl?: string;
  teamsInitialKeys?: any[];
  whatsAppVerifyToken?: string;
  whatsAppAppSecret?: string;
  bridgeIdentity?: BridgeIdentity;
  seenSet?: SeenSet;
  piiScrubber?: PiiScrubber;
  targetRoomTopic?: string;
}

export interface AcrBridgeRequest {
  acrBridgeEnvelope?: InboundBridgeEnvelope;
  acrBridgePlatform?: string;
}

/**
 * Creates Express-compatible middleware for authenticating, replay-checking,
 * PII-scrubbing, and re-signing enterprise webhooks.
 */
export function createBridgeExpressMiddleware(options: BridgeMiddlewareOptions = {}) {
  const bridgeIdentity = options.bridgeIdentity || new BridgeIdentity();
  const seenSet = options.seenSet || new SeenSet(300);
  const piiScrubber = options.piiScrubber || new PiiScrubber({ mode: 'mask' });

  const slackHandler = options.slackSigningSecret
    ? new SlackInboundHandler({
        signingSecret: options.slackSigningSecret,
        bridgeIdentity,
        seenSet,
        piiScrubber,
        targetRoomTopic: options.targetRoomTopic,
      })
    : undefined;

  const teamsHandler = new TeamsInboundHandler({
    appId: options.teamsAppId,
    expectedIssuer: options.teamsExpectedIssuer,
    jwksEndpointUrl: options.teamsJwksUrl,
    initialKeys: options.teamsInitialKeys,
    bridgeIdentity,
    seenSet,
    piiScrubber,
    targetRoomTopic: options.targetRoomTopic,
  });

  return async function bridgeExpressMiddleware(req: any, res: any, next: (err?: any) => void) {
    try {
      let platform = options.platform || 'auto';

      if (platform === 'auto') {
        const path = req.path || req.url || '';
        if (req.headers['x-slack-signature'] || path.includes('/slack')) {
          platform = 'slack';
        } else if (req.headers['x-hub-signature-256'] || req.query?.['hub.mode'] || path.includes('/whatsapp')) {
          platform = 'whatsapp';
        } else if (req.headers['authorization']?.startsWith('Bearer ') || path.includes('/teams')) {
          platform = 'teams';
        }
      }

      // ─── 1. Slack Inbound ───────────────────────────────────────────
      if (platform === 'slack') {
        if (!slackHandler) {
          res.status(500).json({ error: 'Slack signing secret not configured' });
          return;
        }

        const rawBody = req.rawBody || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));
        const result = await slackHandler.handleWebhook(req.headers, rawBody);

        if (result.isChallenge) {
          res.status(200).json(result.body);
          return;
        }

        if (result.statusCode !== 200) {
          res.status(result.statusCode).json(result.body);
          return;
        }

        req.acrBridgeEnvelope = result.envelope;
        req.acrBridgePlatform = 'slack';
        next();
        return;
      }

      // ─── 2. WhatsApp Inbound ────────────────────────────────────────
      if (platform === 'whatsapp') {
        // GET Verification Challenge
        if (req.method === 'GET') {
          const mode = req.query?.['hub.mode'];
          const token = req.query?.['hub.verify_token'];
          const challenge = req.query?.['hub.challenge'];

          if (mode === 'subscribe' && token === options.whatsAppVerifyToken) {
            res.status(200).send(challenge || '');
            return;
          }
          res.status(403).json({ error: 'WhatsApp verify token mismatch' });
          return;
        }

        // POST Event Processing
        const signature = req.headers['x-hub-signature-256'];
        if (!options.whatsAppAppSecret || !signature || !signature.startsWith('sha256=')) {
          res.status(401).json({ error: 'Missing or invalid WhatsApp X-Hub-Signature-256' });
          return;
        }

        const rawBody = req.rawBody || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));
        const expectedHash = crypto.createHmac('sha256', options.whatsAppAppSecret).update(rawBody).digest('hex');
        const expectedHeader = `sha256=${expectedHash}`;

        try {
          const expectedBuf = Buffer.from(expectedHeader, 'utf-8');
          const actualBuf = Buffer.from(signature, 'utf-8');
          if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
            res.status(401).json({ error: 'WhatsApp signature mismatch' });
            return;
          }
        } catch {
          res.status(401).json({ error: 'WhatsApp signature validation failed' });
          return;
        }

        const parsed = typeof req.body === 'object' ? req.body : JSON.parse(rawBody);
        const msg = parsed?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        if (msg) {
          const channelId = parsed?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id || 'wa_phone';
          const msgId = msg.id || `wa_${Date.now()}`;
          const isFresh = seenSet.checkAndAdd('whatsapp', channelId, msgId);
          if (!isFresh) {
            res.status(200).json({ status: 'IGNORED_DUPLICATE' });
            return;
          }

          const scrubbed = piiScrubber.scrubText(msg.text?.body || '');
          const envelope = bridgeIdentity.signEvent({
            platform: 'whatsapp',
            external_channel_id: channelId,
            external_message_id: msgId,
            author_display: msg.from || 'wa_user',
            content: scrubbed.text,
            target_room_topic: options.targetRoomTopic || 'whatsapp-general',
          });
          req.acrBridgeEnvelope = envelope;
          req.acrBridgePlatform = 'whatsapp';
        }

        next();
        return;
      }

      // ─── 3. Teams Inbound ───────────────────────────────────────────
      if (platform === 'teams') {
        const rawBody = req.rawBody || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));
        const result = await teamsHandler.handleWebhook(req.headers, rawBody);

        if (result.statusCode !== 200) {
          res.status(result.statusCode).json(result.body);
          return;
        }

        req.acrBridgeEnvelope = result.envelope;
        req.acrBridgePlatform = 'teams';
        next();
        return;
      }

      // Platform not recognized
      next();
    } catch (err: any) {
      res.status(500).json({ error: `Bridge middleware error: ${err.message}` });
    }
  };
}

/**
 * Creates Fastify-compatible preValidation hook for authenticating, replay-checking,
 * and re-signing enterprise webhooks.
 */
export function createBridgeFastifyHook(options: BridgeMiddlewareOptions = {}) {
  const expressMiddleware = createBridgeExpressMiddleware(options);

  return async function bridgeFastifyHook(request: any, reply: any) {
    return new Promise<void>((resolve, reject) => {
      // Fastify adapter to express signature
      const resAdapter = {
        status(code: number) {
          reply.code(code);
          return this;
        },
        json(data: any) {
          reply.send(data);
          resolve();
        },
        send(data: any) {
          reply.send(data);
          resolve();
        },
      };

      expressMiddleware(request, resAdapter, (err?: any) => {
        if (err) return reject(err);
        resolve();
      });
    });
  };
}
