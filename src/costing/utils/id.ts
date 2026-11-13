/**
 * Centralized ID & Order Number Generation Strategy
 * 
 * Provides collision-resistant unique IDs for internal entities
 * and sequential/human-readable order numbers for customer transactions.
 * 
 * Complies with Local-First architecture without external dependencies.
 */

/**
 * Generates a unique, collision-resistant internal entity ID.
 * Uses crypto.randomUUID() when available in the environment,
 * with a high-entropy fallback using timestamp + cryptographically random or pseudorandom alphanumeric suffix.
 * 
 * @param prefix Entity prefix (e.g. 'ord', 'ing', 'txn', 'sauce', 'menu', 'var', 'exp', 'waste', 'pur', 'sup')
 * @returns Formatted ID string (e.g. 'ord_9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d' or 'ord_1726742400000_a1b2c3d')
 */
export function generateId(prefix: string): string {
  const cleanPrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '');
  
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${cleanPrefix}_${crypto.randomUUID()}`;
  }
  
  // High-entropy fallback
  const timestamp = Date.now().toString(36);
  const randomEntropy = Math.random().toString(36).substring(2, 10);
  const perfNow = typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? Math.floor(performance.now() * 100).toString(36)
    : '';
    
  return `${cleanPrefix}_${timestamp}${perfNow}_${randomEntropy}`;
}

/**
 * Generates a human-readable business order number for kitchen receipts and cashier operations.
 * Format: ORD-YYYYMMDD-XXXX (e.g. 'ORD-20260919-0001')
 * 
 * @param dateStr Optional ISO date string (defaults to today's date in local time)
 * @param sequence Optional sequence number for the day (1-based index)
 * @returns Human-readable order number string
 */
export function generateOrderNumber(dateStr?: string, sequence?: number): string {
  const targetDate = dateStr ? new Date(dateStr) : new Date();
  
  const year = targetDate.getFullYear();
  const month = String(targetDate.getMonth() + 1).padStart(2, '0');
  const day = String(targetDate.getDate()).padStart(2, '0');
  const dateSegment = `${year}${month}${day}`;
  
  if (typeof sequence === 'number' && sequence > 0) {
    const seqStr = String(sequence).padStart(4, '0');
    return `ORD-${dateSegment}-${seqStr}`;
  }
  
  // Fallback sequential surrogate using timestamp slice + random 2-char hex
  const timeSlice = Date.now().toString().slice(-4);
  return `ORD-${dateSegment}-${timeSlice}`;
}
