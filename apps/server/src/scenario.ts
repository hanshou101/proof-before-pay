// Loads the normative demo scenario (SPEC §6.4) and the inbox items that go with it.
//
// `demo/scenario/scenario.json` is the envelope; `demo/inbox/in_XX.json` carries the body text
// and the attachment records. The recorded sha256 is checked against the bytes on disk here, so
// a dataset that drifted fails loudly at boot instead of producing a proof bundle that lies.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { InboxAttachment, InboxItem, Scenario } from './types.js';

export interface LoadedDemo {
  scenario: Scenario;
  items: InboxItem[];
  byId: Map<string, InboxItem>;
}

interface RawInboxFile {
  id: string;
  to: string;
  bodyText: string;
  attachments: { name: string; path: string; sha256: string }[];
}

export function loadDemo(demoDir: string): LoadedDemo {
  const root = resolve(demoDir);
  const scenario = JSON.parse(readFileSync(join(root, 'scenario', 'scenario.json'), 'utf8')) as Scenario;

  const items: InboxItem[] = scenario.inbox.map((envelope) => {
    const raw = JSON.parse(readFileSync(join(root, 'inbox', `${envelope.id}.json`), 'utf8')) as RawInboxFile;
    const attachments: InboxAttachment[] = raw.attachments.map((attachment) => {
      const absolute = resolve(join(root, '..'), attachment.path);
      const actual = sha256File(absolute);
      if (actual !== attachment.sha256) {
        throw new Error(
          `${attachment.name}: recorded sha256 ${attachment.sha256.slice(0, 12)}… does not match the file on disk (${actual.slice(0, 12)}…)`,
        );
      }
      return { name: attachment.name, path: attachment.path, sha256: attachment.sha256 };
    });

    const listed = envelope.attachments.slice().sort().join('|');
    const actualNames = attachments.map((a) => a.name).sort().join('|');
    if (listed !== actualNames) {
      throw new Error(`${envelope.id}: scenario attachments [${listed}] do not match the inbox JSON [${actualNames}]`);
    }

    return {
      id: envelope.id,
      from: envelope.from,
      to: raw.to,
      subject: envelope.subject,
      receivedAt: envelope.receivedAt,
      bodyText: raw.bodyText,
      attachments,
      layout: envelope.layout,
    };
  });

  return { scenario, items, byId: new Map(items.map((item) => [item.id, item])) };
}

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function vendorOf(scenario: Scenario, id: string | null): Scenario['vendors'][number] | null {
  if (!id) return null;
  return scenario.vendors.find((vendor) => vendor.id === id) ?? null;
}
