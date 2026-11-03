import { hashPhoneE164, LIMITS, normalizeE164 } from '@touchgrass/shared';
import * as Contacts from 'expo-contacts';

export interface LocalContact {
  name: string;
  e164: string;
  hash: string;
}

export type ContactsRead = { granted: false } | { granted: true; contacts: LocalContact[] };

/**
 * Reads the address book on device and hashes every normalised number (SHA-256 of E.164).
 * Only the hashes are ever uploaded (F-SOC-01); names and numbers stay on the phone for display.
 */
export async function readHashedContacts(): Promise<ContactsRead> {
  const { granted } = await Contacts.requestPermissionsAsync();
  if (!granted) return { granted: false };
  // Bulk, field-limited read (SDK 58 API): only names and numbers are loaded.
  const data = await Contacts.Contact.getAllDetails([
    Contacts.ContactField.FULL_NAME,
    Contacts.ContactField.PHONES,
  ] as const);
  const byHash = new Map<string, LocalContact>();
  for (const c of data) {
    for (const p of c.phones) {
      const e164 = p.number ? normalizeE164(p.number) : null;
      if (!e164) continue;
      const hash = hashPhoneE164(e164);
      if (!byHash.has(hash)) byHash.set(hash, { name: c.fullName ?? e164, e164, hash });
      if (byHash.size >= LIMITS.social.maxContactHashes) break;
    }
  }
  return {
    granted: true,
    contacts: [...byHash.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}
