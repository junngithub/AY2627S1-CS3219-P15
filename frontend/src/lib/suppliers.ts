/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the supplier type, the opening-hours check and the
 *        catalogue fetch.
 * Reviewed by Ngooi Jun Sen.
 */

import { api } from './api';

/**
 * Exactly what `GET /api/v1/supplier` returns on origin/supplier-service.
 *
 * DISCREPANCY: Supplier F1.1 lists Type as a core attribute and UI FR10.1.1
 * gives its values as Store, Facility and Landmark, but the service has no
 * such field - only the multi-category tagging from F1.2.1. The filters below
 * therefore work on categories.
 */
export interface Supplier {
  id: number;
  name: string;
  building: string | null;
  floor: string | null;
  locationDescription: string | null;
  latitude: number;
  longitude: number;
  /** "HH:MM", 24-hour. */
  startingTime: string;
  closingTime: string;
  status: 'pending' | 'approved' | 'rejected';
  categories: { id: number; name: string }[];
}

function minutesInto(day: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(day);
  if (match === null) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Supplier F1.1.2 requires the opening time to be earlier than the closing
 * time, so hours are not meant to cross midnight. One seeded row breaks that
 * rule (Supersnacks, 11:00 to 02:00), so the wrap-around case is handled
 * rather than trusted - otherwise that shop reads as closed all day.
 */
export function isOpenAt(supplier: Supplier, now: Date = new Date()): boolean | null {
  const opens = minutesInto(supplier.startingTime);
  const closes = minutesInto(supplier.closingTime);
  if (opens === null || closes === null) return null;

  const current = now.getHours() * 60 + now.getMinutes();
  if (opens === closes) return true; // treated as always open
  if (opens < closes) return current >= opens && current < closes;
  return current >= opens || current < closes;
}

/** "09:00 - 18:00", or "Open 24 hours" when the two times meet. */
export function formatHours(supplier: Supplier): string {
  if (supplier.startingTime === supplier.closingTime) return 'Open 24 hours';
  if (supplier.startingTime === '00:00' && supplier.closingTime === '23:59') return 'Open 24 hours';
  return `${supplier.startingTime} – ${supplier.closingTime}`;
}

export interface SupplierPage {
  items: Supplier[];
  page: number;
  pageSize: number;
  /**
   * Inferred, not returned. The endpoint sends a bare array with no total, so
   * a full page is taken to mean another may follow. A catalogue whose size
   * is an exact multiple of the page size therefore shows one empty page at
   * the end. Recorded in docs/open-items.md as an ask on the service.
   */
  hasMore: boolean;
}

/**
 * UI FR10.1.2 and Supplier F1.4.1: the public endpoint returns Approved
 * suppliers only, so no status filter is sent.
 *
 * Supplier NFR1.1.1 sets the default page at 20 and the cap at 100.
 */
export async function fetchSuppliers(options: {
  page?: number;
  pageSize?: number;
  categories?: string[];
} = {}): Promise<SupplierPage> {
  const page = options.page ?? 1;
  const pageSize = Math.min(options.pageSize ?? 20, 100);

  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  // Supplier F1.2: comma-separated categories, matched as OR, server side.
  if (options.categories && options.categories.length > 0) {
    params.set('category', options.categories.join(','));
  }

  const items = await api.get<Supplier[]>(`/supplier?${params.toString()}`);
  return { items, page, pageSize, hasMore: items.length === pageSize };
}

/** Used by the detail view; Order also uses it to validate a location. */
export async function fetchSupplier(id: number): Promise<Supplier> {
  return api.get<Supplier>(`/supplier/${id}`);
}

export interface NewSupplier {
  name: string;
  building: string;
  floor: string;
  locationDescription: string;
  latitude: number;
  longitude: number;
  startingTime: string;
  closingTime: string;
  categories: string[];
}

/** Supplier F1.1: the listing is created as Pending and awaits approval. */
export async function createSupplier(supplier: NewSupplier): Promise<Supplier> {
  return api.post<Supplier>('/supplier', supplier);
}

/** Admin only, Supplier F1.3.1. The service logs the change with a timestamp. */
export async function fetchSuppliersForAdmin(status?: Supplier['status']): Promise<Supplier[]> {
  const query = status === undefined ? '' : `?status=${status}`;
  return api.get<Supplier[]>(`/supplier/admin${query}`);
}

export async function setSupplierStatus(
  id: number,
  status: Supplier['status'],
): Promise<Supplier> {
  return api.patch<Supplier>(`/supplier/${id}/status`, { status });
}
