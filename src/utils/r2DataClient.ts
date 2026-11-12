import { AiConversationSession, MenuItem, StoreDataPayload } from '../types';
import initialSeedData from '../data/initialStoreData.json';

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
      promoBannerEnabled: Boolean(raw.settings?.promoBannerEnabled),
      promoBannerUrl:
        typeof raw.settings?.promoBannerUrl === 'string' ? raw.settings.promoBannerUrl.trim() : '',
      promoBannerDelaySeconds:
        typeof raw.settings?.promoBannerDelaySeconds === 'number' &&
        Number.isFinite(raw.settings.promoBannerDelaySeconds)
          ? Math.max(0, Math.min(60, raw.settings.promoBannerDelaySeconds))
          : 2,
      promoBannerMaxPerDay:
        typeof raw.settings?.promoBannerMaxPerDay === 'number' &&
        Number.isFinite(raw.settings.promoBannerMaxPerDay)
          ? Math.max(0, Math.min(20, raw.settings.promoBannerMaxPerDay))
          : 2,
      promoBannerClickToMenu: raw.settings?.promoBannerClickToMenu !== false,
      promoBannerTargetUrl:
        typeof raw.settings?.promoBannerTargetUrl === 'string' && raw.settings.promoBannerTargetUrl.trim().length > 0
          ? raw.settings.promoBannerTargetUrl.trim()
          : '/menu',
      promoBannerDiscountEnabled: Boolean(raw.settings?.promoBannerDiscountEnabled),
      promoBannerDiscountType:
        raw.settings?.promoBannerDiscountType === 'fixed' ? 'fixed' : 'percent',
      promoBannerDiscountValue:
        typeof raw.settings?.promoBannerDiscountValue === 'number' &&
        Number.isFinite(raw.settings.promoBannerDiscountValue) &&
        raw.settings.promoBannerDiscountValue >= 0
          ? Math.round(raw.settings.promoBannerDiscountValue * 100) / 100
          : 0,
      activePromoBannerId:
        typeof raw.settings?.activePromoBannerId === 'string'
          ? raw.settings.activePromoBannerId.trim()
          : '',
      savedPromoBanners: Array.isArray(raw.settings?.savedPromoBanners)
        ? raw.settings.savedPromoBanners
            .filter((b: any) => b && typeof b.imgUrl === 'string' && b.imgUrl.trim().length > 0)
            .slice(0, 15)
            .map((b: any) => ({
              id: String(b.id || `banner-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
              label: typeof b.label === 'string' ? b.label.trim().slice(0, 60) : '',
              imgUrl: String(b.imgUrl).trim(),
              delaySeconds:
                typeof b.delaySeconds === 'number' && b.delaySeconds >= 0 && b.delaySeconds <= 60
                  ? Math.round(b.delaySeconds)
                  : 2,
              maxPerDay:
                typeof b.maxPerDay === 'number' && b.maxPerDay >= 0 && b.maxPerDay <= 20
                  ? Math.round(b.maxPerDay)
                  : 2,
              clickToMenu: b.clickToMenu !== false,
              targetUrl:
                typeof b.targetUrl === 'string' && b.targetUrl.trim().length > 0
                  ? b.targetUrl.trim()
                  : '/menu',
              discountEnabled: Boolean(b.discountEnabled),
              discountType: b.discountType === 'fixed' ? 'fixed' : 'percent',
              discountValue:
                typeof b.discountValue === 'number' &&
                Number.isFinite(b.discountValue) &&
                b.discountValue >= 0
                  ? Math.round(b.discountValue * 100) / 100
                  : 0,
              sizeBadge: typeof b.sizeBadge === 'string' ? b.sizeBadge.trim().slice(0, 60) : '',
              createdAt:
                typeof b.createdAt === 'string' && b.createdAt.trim()
                  ? b.createdAt.trim()
                  : new Date().toISOString(),
            }))
        : [],
    },
    categories: Array.isArray(raw.categories) ? raw.categories : seed.categories || [],
    items: (Array.isArray(raw.items) ? raw.items : seed.items || []).map((it: any) => {
      const idLower = String(it?.id || '').toLowerCase().trim();
      const titleLower = String(it?.title || '').toLowerCase().trim();
      if (idLower === 'truffle-burger' || titleLower === 'truffle burger') {
        return { ...it, isNew: false };
      }
      return it;
    }),
    reviews: Array.isArray(raw.reviews) ? raw.reviews : seed.reviews || [],
    admins: Array.isArray(raw.admins) ? raw.admins : [],
    clientIpHash: typeof raw.clientIpHash === 'string' ? raw.clientIpHash : undefined,
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
      window.dispatchEvent(new CustomEvent('corano-store-updated', { detail: publicSafe }));
    } catch {
      // ignore quota/storage errors
    }
  }
}

let inFlightPublicFetch: Promise<StoreDataPayload> | null = null;
let lastPublicFetchAt = 0;
let lastPublicPayload: StoreDataPayload | null = null;
const PUBLIC_FETCH_DEDUPE_MS = 2000;

export async function fetchLiveStoreData(
  includeAdminAuth: boolean = false
): Promise<StoreDataPayload> {
  if (!includeAdminAuth) {
    if (
      lastPublicPayload &&
      Date.now() - lastPublicFetchAt < PUBLIC_FETCH_DEDUPE_MS
    ) {
      return lastPublicPayload;
    }
    if (inFlightPublicFetch) {
      return inFlightPublicFetch;
    }
  }

  const performFetch = async (): Promise<StoreDataPayload> => {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
    };

    if (includeAdminAuth) {
      try {
        const { auth } = await import('../firebase');
        if (auth.currentUser) {
          const idToken = await auth.currentUser.getIdToken();
          headers['Authorization'] = `Bearer ${idToken}`;
        }
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
        const result = includeAdminAuth ? data : sanitizeForPublicCache(data);
        if (!includeAdminAuth) {
          lastPublicPayload = result;
          lastPublicFetchAt = Date.now();
        }
        return result;
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
        const result = includeAdminAuth ? data : sanitizeForPublicCache(data);
        if (!includeAdminAuth) {
          lastPublicPayload = result;
          lastPublicFetchAt = Date.now();
        }
        return result;
      }
    } catch {
      // fallback to cached data
    }

    return getCachedStoreData();
  };

  if (!includeAdminAuth) {
    inFlightPublicFetch = performFetch().finally(() => {
      inFlightPublicFetch = null;
    });
    return inFlightPublicFetch;
  }

  return performFetch();
}

export async function mutateR2StoreData(
  action: string,
  payload: Record<string, any> = {}
): Promise<StoreDataPayload> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (action !== 'submitPublicReview') {
    const { auth } = await import('../firebase');
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
  lastPublicPayload = sanitizeForPublicCache(updatedStore);
  lastPublicFetchAt = Date.now();
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
  const { auth } = await import('../firebase');
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
  const { auth } = await import('../firebase');
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

