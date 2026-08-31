import * as Y from 'yjs';
import { AwarenessStore, UserAwarenessState } from './awareness-store.js';

export interface YSweetClientOptions {
  serverUrl: string;
  docId: string;
  userDid: string;
  userHandle?: string;
}

export class YSweetPresenceClient {
  public readonly doc: Y.Doc;
  public readonly awarenessStore: AwarenessStore;
  public readonly userDid: string;
  public readonly userHandle?: string;
  private presenceMap: Y.Map<any>;
  private isConnected = false;

  constructor(options: YSweetClientOptions) {
    this.doc = new Y.Doc({ guid: options.docId });
    this.awarenessStore = new AwarenessStore();
    this.userDid = options.userDid;
    this.userHandle = options.userHandle;
    this.presenceMap = this.doc.getMap('presence');

    // Subscribe to Yjs CRDT map changes
    this.presenceMap.observe((event: Y.YMapEvent<any>) => {
      event.changes.keys.forEach((change: any, key: string) => {
        if (change.action === 'add' || change.action === 'update') {
          const val = this.presenceMap.get(key);
          if (val) {
            this.awarenessStore.setLocalState(val);
          }
        }
      });
    });
  }

  public connect(): boolean {
    this.isConnected = true;
    this.updateTyping(false);
    return true;
  }

  public disconnect(): void {
    this.isConnected = false;
    this.doc.transact(() => {
      this.presenceMap.delete(this.userDid);
    });
  }

  public updateTyping(isTyping: boolean, roomId?: string): void {
    if (!this.isConnected) return;
    const state: UserAwarenessState = {
      did: this.userDid,
      handle: this.userHandle,
      isTyping,
      status: 'ONLINE',
      lastActive: Date.now(),
      focusedRoomId: roomId,
    };
    this.doc.transact(() => {
      this.presenceMap.set(this.userDid, state);
    });
    this.awarenessStore.setLocalState(state);
  }

  public getAwareness(): AwarenessStore {
    return this.awarenessStore;
  }

  public getRawYjsDoc(): Y.Doc {
    return this.doc;
  }
}
