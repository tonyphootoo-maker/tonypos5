import { ChannelDoc, CustomerDoc, Language } from '../types';

export type PosCoreChannelId = 'dine_in' | 'takeaway' | 'delivery';

export const POS_CORE_CHANNEL_IDS: readonly PosCoreChannelId[] = [
  'dine_in',
  'takeaway',
  'delivery',
] as const;

export function buildDefaultPosChannels(nowIso: string = new Date().toISOString()): ChannelDoc[] {
  return [
    {
      id: 'dine_in',
      name: 'Dine-In',
      nameTh: 'ทานที่ร้าน',
      type: 'dine_in',
      commissionPercent: 0,
      packagingCost: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
      version: 1,
    },
    {
      id: 'takeaway',
      name: 'Takeaway',
      nameTh: 'สั่งกลับบ้าน',
      type: 'takeaway',
      commissionPercent: 0,
      packagingCost: 5,
      createdAt: nowIso,
      updatedAt: nowIso,
      version: 1,
    },
    {
      id: 'delivery',
      name: 'Delivery',
      nameTh: 'Delivery',
      type: 'delivery',
      commissionPercent: 0,
      packagingCost: 10,
      createdAt: nowIso,
      updatedAt: nowIso,
      version: 1,
    },
  ];
}

/**
 * Resolves the strictly 3 POS order channels shown in the POS Current Bill selector:
 * 1. dine_in  -> ทานที่ร้าน
 * 2. takeaway -> สั่งกลับบ้าน (รอรับหน้าร้าน)
 * 3. delivery -> Delivery (ส่งที่บ้านลูกค้า)
 * Preserves stored pricing/packaging settings if present, and guarantees all 3 exist
 * while hiding third-party aggregators (GrabFood / LINE MAN) from the POS selector.
 */
export function resolvePosOrderChannels(channels: ChannelDoc[]): ChannelDoc[] {
  const defaults = buildDefaultPosChannels('');
  const defaultMap = new Map(defaults.map((d) => [d.id, d]));

  const dineIn =
    channels.find((c) => c.id === 'dine_in') ||
    channels.find((c) => c.type === 'dine_in') ||
    defaultMap.get('dine_in')!;

  const takeaway =
    channels.find((c) => c.id === 'takeaway') ||
    channels.find((c) => c.type === 'takeaway') ||
    defaultMap.get('takeaway')!;

  const delivery =
    channels.find((c) => c.id === 'delivery') ||
    defaultMap.get('delivery')!;

  return [
    { ...dineIn, id: dineIn.id || 'dine_in', type: 'dine_in' },
    { ...takeaway, id: takeaway.id || 'takeaway', type: 'takeaway' },
    { ...delivery, id: delivery.id || 'delivery', type: 'delivery' },
  ];
}

export function getPosChannelOptionLabel(channel: ChannelDoc, lang: Language): string {
  if (channel.type === 'dine_in' || channel.id === 'dine_in') {
    return lang === 'th' ? 'ทานที่ร้าน' : 'Dine-In';
  }
  if (channel.type === 'takeaway' || channel.id === 'takeaway') {
    return lang === 'th' ? 'สั่งกลับบ้าน (รอรับหน้าร้าน)' : 'Takeaway (Pickup)';
  }
  return lang === 'th' ? 'Delivery (ส่งที่บ้านลูกค้า)' : 'Delivery (Home)';
}

export function normalizePosChannelId(
  channelId: string | undefined | null,
  posChannels: ChannelDoc[]
): string {
  if (!channelId) return posChannels[0]?.id || 'dine_in';
  if (posChannels.some((c) => c.id === channelId)) return channelId;
  // Map legacy third-party delivery channel IDs on reopened bills to 'delivery'
  if (channelId === 'grab' || channelId === 'lineman' || channelId === 'robinhood') {
    return posChannels.find((c) => c.type === 'delivery')?.id || 'delivery';
  }
  return posChannels[0]?.id || 'dine_in';
}

export function normalizePhoneDigits(phone: string): string {
  return (phone || '').replace(/\D+/g, '');
}

/**
 * Extracts a likely house number token (e.g. "123/45", "99", "88/1-2") from an address
 * when an explicit houseNumber isn't supplied.
 */
export function extractHouseNumber(address: string, explicitHouseNumber?: string): string {
  const explicit = (explicitHouseNumber || '').trim();
  if (explicit) return explicit;
  const trimmed = (address || '').trim();
  if (!trimmed) return '';
  // Look for Thai address house-number pattern like "123/45" or leading "123"
  const match =
    trimmed.match(/(?:บ้านเลขที่|เลขที่|No\.?|#)?\s*(\d+(?:\/\d+)?(?:-\d+)?)/i) ||
    trimmed.match(/^(\d+(?:\/\d+)?)/);
  return match ? match[1] : '';
}

function normalizeText(value: string): string {
  return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Searches saved customers prioritizing House Number and Phone Number,
 * with fallback to full Address, Name, and Notes.
 */
export function searchCustomers(customers: CustomerDoc[], rawQuery: string): CustomerDoc[] {
  const query = normalizeText(rawQuery);
  if (!query) {
    return [...customers].sort((a, b) =>
      (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '') ||
      (a.name || '').localeCompare(b.name || '', 'th')
    );
  }

  const queryNoSpaces = query.replace(/\s+/g, '');
  const queryDigits = normalizePhoneDigits(rawQuery);
  const hasDigits = queryDigits.length > 0;

  const scored: { customer: CustomerDoc; score: number }[] = [];

  for (const customer of customers) {
    const houseNo = normalizeText(
      customer.houseNumber || extractHouseNumber(customer.address)
    );
    const houseNoCompact = houseNo.replace(/\s+/g, '');
    const addressNorm = normalizeText(customer.address);
    const addressCompact = addressNorm.replace(/\s+/g, '');
    const phoneDigits = normalizePhoneDigits(customer.phone);
    const nameNorm = normalizeText(customer.name);
    const notesNorm = normalizeText(customer.notes || '');

    let score = 0;

    // 1. Exact House Number match
    if (houseNoCompact && (houseNoCompact === queryNoSpaces || houseNoCompact === queryDigits)) {
      score = Math.max(score, 120);
    }

    // 2. Prefix House Number match (e.g., query "123" matches "123/45")
    if (houseNoCompact && (houseNoCompact.startsWith(queryNoSpaces) || (hasDigits && houseNoCompact.startsWith(queryDigits)))) {
      score = Math.max(score, 100);
    }

    // 3. Token in address matching house number exactly/prefix (e.g., "123/45" inside "123/45 หมู่ 2...")
    const addressTokens = addressNorm.split(/[\s,]+/).filter(Boolean);
    if (addressTokens.some((tok) => tok === queryNoSpaces)) {
      score = Math.max(score, 95);
    } else if (addressTokens.some((tok) => /^\d/.test(tok) && tok.startsWith(queryNoSpaces))) {
      score = Math.max(score, 85);
    }

    // 4. Phone number match (ignoring dashes/spaces)
    if (hasDigits && phoneDigits) {
      if (phoneDigits === queryDigits) {
        score = Math.max(score, 115);
      } else if (phoneDigits.startsWith(queryDigits) || phoneDigits.endsWith(queryDigits)) {
        score = Math.max(score, 90);
      } else if (phoneDigits.includes(queryDigits)) {
        score = Math.max(score, 75);
      }
    }

    // 5. House number or address substring match
    if (houseNoCompact && houseNoCompact.includes(queryNoSpaces)) {
      score = Math.max(score, 70);
    }
    if (addressNorm.includes(query) || addressCompact.includes(queryNoSpaces)) {
      score = Math.max(score, 60);
    }

    // 6. Customer name / notes fallback
    if (nameNorm.startsWith(query)) {
      score = Math.max(score, 65);
    } else if (nameNorm.includes(query)) {
      score = Math.max(score, 50);
    } else if (notesNorm && notesNorm.includes(query)) {
      score = Math.max(score, 35);
    }

    if (score > 0) {
      scored.push({ customer, score });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (a.customer.name || '').localeCompare(b.customer.name || '', 'th');
  });

  return scored.map((entry) => entry.customer);
}
