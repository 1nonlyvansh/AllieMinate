import { EventEmitter } from 'node:events';
import type { SyncEvent } from '@alliminate/shared';

export const syncEvents = new EventEmitter();

export function emitSyncEvent(event: SyncEvent): void {
  syncEvents.emit('sync-event', event);
}
