import type { Database } from '../db/database.js';
import { transaction } from '../db/database.js';
import { getSetting, setSetting } from '../db/settings.js';
import { nowSeconds } from '../lib/time.js';
import { addChannel } from './repository.js';
import type { NewRequiredChannel } from './types.js';

const SEED_KEY = 'channels_seeded_v1';

export const DEFAULT_CHANNELS: readonly NewRequiredChannel[] = [
  {
    chatRef: '@prostutibd',
    chatId: null,
    title: 'Prostuti BD',
    joinUrl: 'https://t.me/prostutibd',
  },
  {
    chatRef: '@admissionfreepdf',
    chatId: null,
    title: 'Admission Free PDF',
    joinUrl: 'https://t.me/admissionfreepdf',
  },
];

export function seedDefaultChannels(db: Database, at = nowSeconds()): { seeded: number } {
  if (getSetting(db, SEED_KEY)) return { seeded: 0 };

  const seeded = transaction(db, () => {
    let count = 0;
    for (const channel of DEFAULT_CHANNELS) {
      const result = addChannel(db, channel, at);
      if (result.created) count += 1;
    }
    setSetting(db, SEED_KEY, '1', at);
    return count;
  });

  return { seeded };
}
