import { AiConversationSession, MenuItem, StoreDataPayload } from '../types';
import initialSeedData from '../data/initialStoreData.json';
import { auth } from '../firebase';

export const R2_STORE_CACHE_KEY = 'corano_r2_store_cache_v1';
const R2_PUBLIC_DATA_URL = 'https://images.restocorano.com/data/store-data.json';

function normalizePayload(raw: any): StoreDataPayload {
  const seed = initialSeedData as unknown as StoreDataPayload;
  if (!raw || typeof raw !== 'object') return seed;
  return {
    version: typeof raw.version === 'number' ? raw.version : seed.version || Date.now(),
    updatedAt:
      typeof raw.updatedAt === 'string'
        ? raw.updatedAt
        : seed.updatedAt || new Date().toISOString(),
    settings: {
      currency: raw.settings?.currency === 'LBP' ? 'LBP' : 'USD',
      exchangeRate:
        typeof raw.settings?.exchangeRate === 'number' && raw.settings.exchangeRate > 0
          ? raw.settings.exchangeRate
          : 89000,
      aiEnabled: raw.settings?.aiEnabled !== false,
      aiBubbleLabel:
        typeof raw.settings?.aiBubbleLabel === 'string' && raw.settings.aiBubbleLabel.trim()
          ? raw.settings.aiBubbleLabel.trim().slice(0, 28)
          : 'Corano AI',
    },
    categories: Array.isArray(raw.categories) ? raw.categories : seed.categories || [],
    items: Array.isArray(raw.items) ? raw.items : seed.items || [],
    reviews: Array.isArray(raw.reviews) ? raw.reviews : seed.reviews || [],
    admins: Array.isArray(raw.admins) ? raw.admins : [],
  };
}

function sanitizeForPublicCache(data: StoreDataPayload): StoreDataPayload {
  return {
    ...data,
    reviews: (data.reviews || []).filter((r) => !r.status || r.status === 'approved'),
    admins: [],
  };
}

export function getCachedStoreData(): StoreDataPayload {
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(R2_STORE_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.items) && Array.isArray(parsed.categories)) {
          return sanitizeForPublicCache(normalizePayload(parsed));
        }
      }
    } catch {
      // ignore localStorage read errors
    }
  }
  return sanitizeForPublicCache(normalizePayload(initialSeedData));
}

export function saveCachedStoreData(data: StoreDataPayload): void {
  if (typeof window !== 'undefined') {
    try {
      const publicSafe = sanitizeForPublicCache(data);
      window.localStorage.setItem(R2_STORE_CACHE_KEY, JSON.stringify(publicSafe));
    } catch {
      // ignore quota/storage errors
    }
  }
}

export async function fetchLiveStoreData(
  includeAdminAuth: boolean = false
): Promise<StoreDataPayload> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Cache-Control': 'no-cache',
  };

  if (includeAdminAuth && auth.currentUser) {
    try {
      const idToken = await auth.currentUser.getIdToken();
      headers['Authorization'] = `Bearer ${idToken}`;
    } catch {
      // continue without token if token fetch fails
    }
  }

  // 1. Primary: Fetch from /api/r2-data (no-cache live R2 read)
  try {
    const res = await fetch(`/api/r2-data?t=${Date.now()}`, {
      method: 'GET',
      headers,
    });
    if (res.ok) {
      const data = normalizePayload(await res.json());
      saveCachedStoreData(data);
      return includeAdminAuth ? data : sanitizeForPublicCache(data);
    }
  } catch {
    // fallback to public R2 domain below
  }

  // 2. Fallback: Direct public R2 CDN fetch with cache-buster (sanitized for public use)
  try {
    const pubRes = await fetch(`${R2_PUBLIC_DATA_URL}?t=${Date.now()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (pubRes.ok) {
      const data = normalizePayload(await pubRes.json());
      saveCachedStoreData(data);
      return includeAdminAuth ? data : sanitizeForPublicCache(data);
    }
  } catch {
    // fallback to cached data
  }

  return getCachedStoreData();
}

export async function mutateR2StoreData(
  action: string,
  payload: Record<string, any> = {}
): Promise<StoreDataPayload> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (action !== 'submitPublicReview') {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('Please sign in with your Google Admin account first.');
    }
    const idToken = await currentUser.getIdToken();
    headers['Authorization'] = `Bearer ${idToken}`;
  }

  const res = await fetch('/api/r2-data', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action,
      ...payload,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Save failed (${res.status})`);
  }

  const updatedStore = normalizePayload(data.storeData || data);
  saveCachedStoreData(updatedStore);
  return updatedStore;
}

export async function askCoranoAiWaiter(params: {
  sessionId: string;
  guestName?: string;
  message: string;
  history: Array<{ role: 'user' | 'assistant'; text: string; recommendedItemIds?: string[] }>;
}): Promise<{
  sessionId: string;
  reply: string;
  recommendedItemIds: string[];
  recommendedItems: MenuItem[];
  summary: string;
  topicTag: string;
  language: 'English' | 'Lebanese' | 'Arabic';
}> {
  const res = await fetch('/api/corano-ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'Corano AI is temporarily busy.');
  }
  return data;
}

export async function fetchAiConversations(): Promise<AiConversationSession[]> {
  const currentUser = auth.currentUser;
  if (!currentUser) return [];
  const idToken = await currentUser.getIdToken();
  const res = await fetch(`/api/corano-ai?t=${Date.now()}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
  });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data?.conversations) ? data.conversations : [];
}

export async function deleteAiConversations(params: {
  id?: string;
  clearAll?: boolean;
}): Promise<AiConversationSession[]> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Please sign in with your Google Admin account first.');
  }
  const idToken = await currentUser.getIdToken();
  const res = await fetch('/api/corano-ai', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'Failed to delete AI conversation.');
  }
  return Array.isArray(data?.conversations) ? data.conversations : [];
}

