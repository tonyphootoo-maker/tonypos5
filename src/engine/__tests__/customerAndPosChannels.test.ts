import { describe, it, expect } from 'vitest';
import {
  resolvePosOrderChannels,
  getPosChannelOptionLabel,
  normalizePosChannelId,
  extractHouseNumber,
  searchCustomers,
} from '../customers';
import { ChannelDoc, CustomerDoc } from '../../types';

const makeChannel = (
  id: string,
  name: string,
  nameTh: string,
  type: ChannelDoc['type'],
  commissionPercent = 0,
  packagingCost = 0
): ChannelDoc => ({
  id,
  name,
  nameTh,
  type,
  commissionPercent,
  packagingCost,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  version: 1,
});

const makeCustomer = (
  id: string,
  name: string,
  phone: string,
  address: string,
  houseNumber?: string,
  notes?: string
): CustomerDoc => ({
  id,
  name,
  phone,
  address,
  houseNumber,
  notes,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  version: 1,
});

describe('POS 3-Channel Selector Resolution', () => {
  it('filters out third-party aggregators (Grab/LINE MAN) and always provides strictly Dine-In, Takeaway, Delivery', () => {
    const legacyChannels: ChannelDoc[] = [
      makeChannel('dine_in', 'Dine-In', 'ทานที่ร้าน', 'dine_in', 0, 0),
      makeChannel('takeaway', 'Takeaway', 'สั่งกลับบ้าน', 'takeaway', 0, 5),
      makeChannel('grab', 'GrabFood', 'แกร็บฟู้ด', 'delivery', 30, 10),
      makeChannel('lineman', 'LINE MAN', 'ไลน์แมน', 'delivery', 30, 10),
    ];

    const resolved = resolvePosOrderChannels(legacyChannels);
    expect(resolved).toHaveLength(3);
    expect(resolved.map((c) => c.id)).toEqual(['dine_in', 'takeaway', 'delivery']);
    expect(resolved.map((c) => c.type)).toEqual(['dine_in', 'takeaway', 'delivery']);
    expect(resolved[2].commissionPercent).toBe(0);

    expect(getPosChannelOptionLabel(resolved[0], 'th')).toBe('ทานที่ร้าน');
    expect(getPosChannelOptionLabel(resolved[1], 'th')).toBe('สั่งกลับบ้าน (รอรับหน้าร้าน)');
    expect(getPosChannelOptionLabel(resolved[2], 'th')).toBe('Delivery (ส่งที่บ้านลูกค้า)');
  });

  it('normalizes legacy delivery channel IDs to delivery', () => {
    const resolved = resolvePosOrderChannels([]);
    expect(normalizePosChannelId('grab', resolved)).toBe('delivery');
    expect(normalizePosChannelId('lineman', resolved)).toBe('delivery');
    expect(normalizePosChannelId('takeaway', resolved)).toBe('takeaway');
    expect(normalizePosChannelId('dine_in', resolved)).toBe('dine_in');
  });
});

describe('Customer House Number Extraction & Search', () => {
  const customers: CustomerDoc[] = [
    makeCustomer('c1', 'คุณสมชาย', '081-234-5678', '123/45 หมู่บ้านสุขใจ ซอย 3'),
    makeCustomer('c2', 'คุณวิภา', '089-999-1122', '88/9 ถนนสุขุมวิท', '88/9', 'ประตูสีขาว'),
    makeCustomer('c3', 'คุณมานะ', '086-555-0123', '45 ซอย 12', '45'),
  ];

  it('extracts Thai house number automatically from full address', () => {
    expect(extractHouseNumber('123/45 หมู่บ้านสุขใจ ซอย 3')).toBe('123/45');
    expect(extractHouseNumber('บ้านเลขที่ 99/1 ซ.5')).toBe('99/1');
    expect(extractHouseNumber('88/9 ถนนสุขุมวิท', ' 88/9 ')).toBe('88/9');
  });

  it('prioritizes house number search matches accurately', () => {
    const res1 = searchCustomers(customers, '123/45');
    expect(res1.map((c) => c.id)).toEqual(['c1']);

    const res2 = searchCustomers(customers, '88/9');
    expect(res2[0].id).toBe('c2');

    // House number "45" finds exact house no. "45" first, ahead of "123/45"
    const res3 = searchCustomers(customers, '45');
    expect(res3[0].id).toBe('c3');
    expect(res3.map((c) => c.id)).toContain('c1');
  });

  it('matches phone numbers with or without dashes/spaces', () => {
    const byPlainDigits = searchCustomers(customers, '0812345678');
    expect(byPlainDigits.map((c) => c.id)).toEqual(['c1']);

    const byPartial = searchCustomers(customers, '9991122');
    expect(byPartial.map((c) => c.id)).toEqual(['c2']);
  });

  it('matches customer names and delivery notes as fallback', () => {
    expect(searchCustomers(customers, 'สมชาย').map((c) => c.id)).toEqual(['c1']);
    expect(searchCustomers(customers, 'ประตูสีขาว').map((c) => c.id)).toEqual(['c2']);
  });
});
