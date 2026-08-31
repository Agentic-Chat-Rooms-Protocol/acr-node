import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

export interface P2PFrame {
  id: string;
  sourceKey: string;
  targetKey: string;
  seq: number;
  payload: Uint8Array;
  checksum: string;
  timestamp: number;
}

export class P2PStreamHandler {
  private seqCounter = 0;

  public encodeFrame(sourceKey: string, targetKey: string, payload: Uint8Array): Uint8Array {
    this.seqCounter++;
    const checksum = createHash('sha256').update(payload).digest('hex');
    const header = JSON.stringify({
      id: `frame-${Date.now()}-${this.seqCounter}`,
      sourceKey,
      targetKey,
      seq: this.seqCounter,
      checksum,
      timestamp: Date.now(),
      payloadLen: payload.length,
    });

    const headerBytes = Buffer.from(header, 'utf-8');
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32BE(headerBytes.length, 0);

    return Buffer.concat([lengthBuffer, headerBytes, payload]);
  }

  public decodeFrame(data: Uint8Array): { frame: P2PFrame; payload: Uint8Array } {
    const buf = Buffer.from(data);
    if (buf.length < 4) {
      throw new Error(`MALFORMED_FRAME: Buffer too short (${buf.length} bytes)`);
    }

    const headerLen = buf.readUInt32BE(0);
    if (buf.length < 4 + headerLen) {
      throw new Error(`MALFORMED_FRAME: Incomplete header length`);
    }

    const headerStr = buf.subarray(4, 4 + headerLen).toString('utf-8');
    const header = JSON.parse(headerStr);
    const payload = buf.subarray(4 + headerLen);

    const computedChecksum = createHash('sha256').update(payload).digest('hex');
    if (computedChecksum !== header.checksum) {
      throw new Error(`CHECKSUM_MISMATCH: Computed ${computedChecksum} !== Header ${header.checksum}`);
    }

    return {
      frame: {
        id: header.id,
        sourceKey: header.sourceKey,
        targetKey: header.targetKey,
        seq: header.seq,
        payload,
        checksum: header.checksum,
        timestamp: header.timestamp,
      },
      payload,
    };
  }
}
