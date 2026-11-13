import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { auth, googleProvider } from '../firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import {
  MenuItem,
  MenuCategory,
  Review,
  AdminUser,
  StoreDataPayload,
  AiConversationSession,
  SavedPromoBanner,
  PromoDiscountType,
} from '../types';
import {
  buildCollisionProofFileName,
  compressImageToBudget,
  deleteImageFromR2,
  readOriginalImageForBanner,
  sanitizeFirestorePayload,
  sanitizeSlug,
  uploadCompressedToR2,
} from '../utils/imageCompressor';
import {
  computeDiscountedUsdPriceString,
  convertLbpInputToUsdString,
  convertUsdStringToLbpInput,
  DEFAULT_LBP_RATE,
  formatDiscountBadgeText,
  formatStorePrice,
  StoreCurrency,
} from '../utils/currency';
import {
  deleteAiConversations,
  fetchAiConversations,
  fetchLiveStoreData,
  getCachedStoreData,
  mutateR2StoreData,
} from '../utils/r2DataClient';
import AdminSvgIcon from '../components/AdminSvgIcon';

export const ROOT_ADMIN_EMAILS = ['apolokor@gmail.com'];

type AdminSection = 'dashboard' | 'products' | 'categories' | 'reviews' | 'ai' | 'settings';

interface DeleteConfirmationState {
  type:
    | 'item'
    | 'category'
    | 'review'
    | 'ai_session'
    | 'ai_clear_all'
    | 'admin_email'
    | 'promo_banner'
    | 'saved_promo_banner';
  id: string;
  label: string;
}

function parseCategoryOrder(raw: string | number | undefined, fallback: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const cleaned = String(raw ?? '')
    .trim()
    .replace(/,/g, '.');
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getCategoryIconName(catName: string): string {
  const lower = (catName || '').toLowerCase();
  if (lower.includes('pizza') || lower.includes('saj')) return 'local_pizza';
  if (lower.includes('burger') || lower.includes('sub') || lower.includes('sandwich'))
    return 'lunch_dining';
  if (lower.includes('salad')) return 'eco';
  if (lower.includes('healthy') || lower.includes('light')) return 'spa';
  if (lower.includes('dessert') || lower.includes('sweet')) return 'cake';
  if (lower.includes('drink') || lower.includes('beverage') || lower.includes('juice'))
    return 'local_cafe';
  if (lower.includes('mashewe') || lower.includes('grill') || lower.includes('bbq'))
    return 'outdoor_grill';
  if (lower.includes('sauce')) return 'water_drop';
  if (lower.includes('appetizer') || lower.includes('mezza') || lower.includes('falafel'))
    return 'tapas';
  return 'restaurant_menu';
}

const Admin = () => {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthorizedAdmin, setIsAuthorizedAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  // Data States
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [dynamicAdmins, setDynamicAdmins] = useState<AdminUser[]>([]);
  const [aiConversations, setAiConversations] = useState<AiConversationSession[]>([]);
  const [loadingAiLogs, setLoadingAiLogs] = useState(false);

  // Global Store Currency State ($ USD vs L.L. at 89,000) & Corano AI Bubble Visibility + Label
  const [storeCurrency, setStoreCurrency] = useState<StoreCurrency>('USD');
  const [exchangeRate, setExchangeRate] = useState<number>(DEFAULT_LBP_RATE);
  const [savingCurrency, setSavingCurrency] = useState(false);
  const [aiEnabled, setAiEnabled] = useState<boolean>(true);
  const [savingAiToggle, setSavingAiToggle] = useState(false);
  const [aiBubbleLabel, setAiBubbleLabel] = useState<string>('Corano AI');
  const [aiBubbleLabelDraft, setAiBubbleLabelDraft] = useState<string>('Corano AI');
  const [savingAiLabel, setSavingAiLabel] = useState<boolean>(false);

  // Homepage Promotional Banner Pop-Up States & Save Banners Library (Up to 15)
  const [promoBannerEnabled, setPromoBannerEnabled] = useState<boolean>(false);
  const [promoBannerUrl, setPromoBannerUrl] = useState<string>('');
  const [promoBannerDelaySeconds, setPromoBannerDelaySeconds] = useState<number>(2);
  const [promoBannerDelayInput, setPromoBannerDelayInput] = useState<string>('2');
  const [promoBannerMaxPerDay, setPromoBannerMaxPerDay] = useState<number>(2);
  const [promoBannerMaxInput, setPromoBannerMaxInput] = useState<string>('2');
  const [promoBannerClickToMenu, setPromoBannerClickToMenu] = useState<boolean>(true);
  const [promoBannerTargetUrl, setPromoBannerTargetUrl] = useState<string>('/menu');
  const [promoBannerDiscountEnabled, setPromoBannerDiscountEnabled] = useState<boolean>(false);
  const [promoBannerDiscountType, setPromoBannerDiscountType] = useState<PromoDiscountType>('percent');
  const [promoBannerDiscountValue, setPromoBannerDiscountValue] = useState<number>(0);
  const [promoBannerDiscountInput, setPromoBannerDiscountInput] = useState<string>('');
  const [promoBannerDiscountInputCurrency, setPromoBannerDiscountInputCurrency] =
    useState<StoreCurrency>('USD');
  const [activePromoBannerId, setActivePromoBannerId] = useState<string>('');
  const [editingBannerId, setEditingBannerId] = useState<string | null>(null);
  const [hasUnsavedBannerDraft, setHasUnsavedBannerDraft] = useState<boolean>(false);
  const [savedPromoBanners, setSavedPromoBanners] = useState<SavedPromoBanner[]>([]);
  const [bannerUploadMode, setBannerUploadMode] = useState<'new' | 'replace'>('new');
  const [bannerDestSearch, setBannerDestSearch] = useState<string>('');
  const [uploadingBannerPhoto, setUploadingBannerPhoto] = useState<boolean>(false);
  const [bannerPhotoBadge, setBannerPhotoBadge] = useState<string | null>(null);
  const [savingBannerSettings, setSavingBannerSettings] = useState<boolean>(false);

  // Navigation & Filters
  const [activeSection, setActiveSection] = useState<AdminSection>('dashboard');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedQuickCategory, setSelectedQuickCategory] = useState<string>('all');
  const [stockFilterTab, setStockFilterTab] = useState<'all' | 'out_of_stock'>('all');

  // Modals & Forms
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [showAddCategoryModal, setShowAddCategoryModal] = useState(false);
  const [newItem, setNewItem] = useState<Partial<MenuItem>>({
    category: 'subs',
    available: true,
    order: 99,
  });
  const [newItemInputCurrency, setNewItemInputCurrency] = useState<StoreCurrency>('USD');
  const [newItemRawPriceInput, setNewItemRawPriceInput] = useState<string>('');
  const [newItemDiscountEnabled, setNewItemDiscountEnabled] = useState<boolean>(false);
  const [newItemDiscountType, setNewItemDiscountType] = useState<PromoDiscountType>('percent');
  const [newItemDiscountInputCurrency, setNewItemDiscountInputCurrency] =
    useState<StoreCurrency>('USD');
  const [newItemDiscountValue, setNewItemDiscountValue] = useState<number>(0);
  const [newItemDiscountInput, setNewItemDiscountInput] = useState<string>('');

  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [editItemInputCurrency, setEditItemInputCurrency] = useState<StoreCurrency>('USD');
  const [editItemRawPriceInput, setEditItemRawPriceInput] = useState<string>('');
  const [editItemDiscountEnabled, setEditItemDiscountEnabled] = useState<boolean>(false);
  const [editItemDiscountType, setEditItemDiscountType] = useState<PromoDiscountType>('percent');
  const [editItemDiscountInputCurrency, setEditItemDiscountInputCurrency] =
    useState<StoreCurrency>('USD');
  const [editItemDiscountValue, setEditItemDiscountValue] = useState<number>(0);
  const [editItemDiscountInput, setEditItemDiscountInput] = useState<string>('');

  const [newCat, setNewCat] = useState<Partial<MenuCategory>>({ name: '', order: 1 });
  const [newCatOrderInput, setNewCatOrderInput] = useState<string>('1');
  const [editingCategory, setEditingCategory] = useState<MenuCategory | null>(null);
  const [editCatOrderInput, setEditCatOrderInput] = useState<string>('');
  const [newReview, setNewReview] = useState<Partial<Review>>({ rating: 5 });

  // Delete Confirmation Modal State
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmationState | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Dynamic Admin Gmail Form State
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [adminStatusMsg, setAdminStatusMsg] = useState<string | null>(null);

  // Image Upload States
  const [uploadingAddPhoto, setUploadingAddPhoto] = useState(false);
  const [addPhotoBadge, setAddPhotoBadge] = useState<string | null>(null);
  const [uploadingEditPhoto, setUploadingEditPhoto] = useState(false);
  const [editPhotoBadge, setEditPhotoBadge] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const [showAdminMenu, setShowAdminMenu] = useState(false);

  const addFileInputRef = useRef<HTMLInputElement | null>(null);
  const editFileInputRef = useRef<HTMLInputElement | null>(null);
  const bannerFileInputRef = useRef<HTMLInputElement | null>(null);
  const promoBannerEditorRef = useRef<HTMLDivElement | null>(null);
  const lastStoreVersionRef = useRef<number>(0);
  const hasUnsavedBannerDraftRef = useRef<boolean>(false);
  const editingBannerIdRef = useRef<string | null>(null);

  useEffect(() => {
    hasUnsavedBannerDraftRef.current = hasUnsavedBannerDraft;
  }, [hasUnsavedBannerDraft]);

  useEffect(() => {
    editingBannerIdRef.current = editingBannerId;
  }, [editingBannerId]);

  const applyStoreState = (
    store: StoreDataPayload,
    options?: { syncEditorBannerId?: string | null; clearDraft?: boolean }
  ) => {
    if (typeof store.version === 'number') {
      lastStoreVersionRef.current = store.version;
    }
    const loadedCats = [...(store.categories || [])].sort(
      (a, b) => (a.order ?? 99) - (b.order ?? 99)
    );
    setCategories(loadedCats);
    setNewCatOrderInput((prev) =>
      prev === '1' && loadedCats.length > 0 ? String(loadedCats.length + 1) : prev
    );
    setItems(store.items || []);
    setReviews(store.reviews || []);
    setDynamicAdmins(store.admins || []);
    if (store.settings?.currency === 'LBP' || store.settings?.currency === 'USD') {
      setStoreCurrency(store.settings.currency);
    }
    if (typeof store.settings?.exchangeRate === 'number' && store.settings.exchangeRate > 0) {
      setExchangeRate(store.settings.exchangeRate);
    }
    setAiEnabled(store.settings?.aiEnabled !== false);
    const nextBubbleLabel = store.settings?.aiBubbleLabel?.trim() || 'Corano AI';
    setAiBubbleLabel(nextBubbleLabel);
    setAiBubbleLabelDraft((prev) => (prev === aiBubbleLabel ? nextBubbleLabel : prev));
    setPromoBannerEnabled(store.settings?.promoBannerEnabled === true);

    const currentUrl = store.settings?.promoBannerUrl || '';
    const loadedDelay =
      typeof store.settings?.promoBannerDelaySeconds === 'number'
        ? store.settings.promoBannerDelaySeconds
        : 2;
    const loadedMax =
      typeof store.settings?.promoBannerMaxPerDay === 'number'
        ? store.settings.promoBannerMaxPerDay
        : 2;
    const loadedClickToMenu = store.settings?.promoBannerClickToMenu !== false;
    const loadedTargetUrl = store.settings?.promoBannerTargetUrl || '/menu';
    const loadedDiscountEnabled = store.settings?.promoBannerDiscountEnabled === true;
    const loadedDiscountType: PromoDiscountType =
      store.settings?.promoBannerDiscountType === 'fixed' ? 'fixed' : 'percent';
    const loadedDiscountValue =
      typeof store.settings?.promoBannerDiscountValue === 'number' &&
      Number.isFinite(store.settings.promoBannerDiscountValue) &&
      store.settings.promoBannerDiscountValue > 0
        ? store.settings.promoBannerDiscountValue
        : 0;

    const rawSavedList = Array.isArray(store.settings?.savedPromoBanners)
      ? [...store.settings.savedPromoBanners]
      : [];
    if (
      currentUrl &&
      !rawSavedList.some((b) => b.imgUrl === currentUrl) &&
      rawSavedList.length === 0
    ) {
      rawSavedList.unshift({
        id: store.settings?.activePromoBannerId || `banner-initial-${Date.now()}`,
        label: loadedTargetUrl,
        imgUrl: currentUrl,
        delaySeconds: loadedDelay,
        maxPerDay: loadedMax,
        clickToMenu: loadedClickToMenu,
        targetUrl: loadedTargetUrl,
        discountEnabled: loadedDiscountEnabled,
        discountType: loadedDiscountType,
        discountValue: loadedDiscountValue,
        createdAt: store.updatedAt || new Date().toISOString(),
      });
    }
    const cappedSavedList = rawSavedList.slice(0, 15);
    setSavedPromoBanners(cappedSavedList);

    const explicitActiveId =
      typeof store.settings?.activePromoBannerId === 'string'
        ? store.settings.activePromoBannerId.trim()
        : '';
    const matchedActiveId =
      explicitActiveId && cappedSavedList.some((b) => b.id === explicitActiveId)
        ? explicitActiveId
        : currentUrl
        ? cappedSavedList.find((b) => b.imgUrl === currentUrl)?.id || ''
        : '';
    setActivePromoBannerId(matchedActiveId);

    if (options?.clearDraft) {
      hasUnsavedBannerDraftRef.current = false;
      setHasUnsavedBannerDraft(false);
    }

    const formatDiscountInputFromBanner = (
      dType: PromoDiscountType,
      dVal: number,
      rateToUse: number
    ): string => {
      if (!dVal || dVal <= 0) return '';
      if (dType === 'percent') {
        return String(Math.round(dVal));
      }
      if (promoBannerDiscountInputCurrency === 'LBP') {
        return convertUsdStringToLbpInput(String(dVal), rateToUse);
      }
      const cleanUsd = Math.round(dVal * 100) / 100;
      return Number.isInteger(cleanUsd) ? String(cleanUsd) : String(cleanUsd);
    };

    const effectiveRate =
      typeof store.settings?.exchangeRate === 'number' && store.settings.exchangeRate > 0
        ? store.settings.exchangeRate
        : exchangeRate || DEFAULT_LBP_RATE;

    // Only overwrite the top Banner Editor fields if the admin does NOT have an unsaved photo/draft in the editor
    if (!hasUnsavedBannerDraftRef.current || options?.clearDraft) {
      const targetEditId =
        options?.syncEditorBannerId !== undefined
          ? options.syncEditorBannerId
          : editingBannerIdRef.current;

      const editorBanner =
        (targetEditId ? cappedSavedList.find((b) => b.id === targetEditId) : null) ||
        (matchedActiveId ? cappedSavedList.find((b) => b.id === matchedActiveId) : null) ||
        cappedSavedList[0] ||
        null;

      if (editorBanner) {
        const bDiscType: PromoDiscountType =
          editorBanner.discountType === 'fixed' ? 'fixed' : 'percent';
        const bDiscVal =
          typeof editorBanner.discountValue === 'number' && editorBanner.discountValue > 0
            ? editorBanner.discountValue
            : 0;
        setEditingBannerId(editorBanner.id);
        setPromoBannerUrl(editorBanner.imgUrl);
        setPromoBannerDelaySeconds(editorBanner.delaySeconds);
        setPromoBannerDelayInput(String(editorBanner.delaySeconds));
        setPromoBannerMaxPerDay(editorBanner.maxPerDay);
        setPromoBannerMaxInput(String(editorBanner.maxPerDay));
        setPromoBannerClickToMenu(editorBanner.clickToMenu);
        setPromoBannerTargetUrl(editorBanner.targetUrl || '/menu');
        setPromoBannerDiscountEnabled(Boolean(editorBanner.discountEnabled && bDiscVal > 0));
        setPromoBannerDiscountType(bDiscType);
        setPromoBannerDiscountValue(bDiscVal);
        setPromoBannerDiscountInput(
          formatDiscountInputFromBanner(bDiscType, bDiscVal, effectiveRate)
        );
        setBannerPhotoBadge(editorBanner.sizeBadge || null);
      } else {
        setEditingBannerId(null);
        setPromoBannerUrl('');
        setPromoBannerDelaySeconds(loadedDelay);
        setPromoBannerDelayInput(String(loadedDelay));
        setPromoBannerMaxPerDay(loadedMax);
        setPromoBannerMaxInput(String(loadedMax));
        setPromoBannerClickToMenu(loadedClickToMenu);
        setPromoBannerTargetUrl(loadedTargetUrl);
        setPromoBannerDiscountEnabled(Boolean(loadedDiscountEnabled && loadedDiscountValue > 0));
        setPromoBannerDiscountType(loadedDiscountType);
        setPromoBannerDiscountValue(loadedDiscountValue);
        setPromoBannerDiscountInput(
          formatDiscountInputFromBanner(loadedDiscountType, loadedDiscountValue, effectiveRate)
        );
        setBannerPhotoBadge(null);
      }
    }
  };

  const fetchAdminData = async () => {
    try {
      const liveStore = await fetchLiveStoreData(true);
      applyStoreState(liveStore);
    } catch (e) {
      console.error('Error loading admin data:', e);
      setStatusNotice('Error loading menu data.');
    }
  };

  const loadAiConversations = async () => {
    setLoadingAiLogs(true);
    try {
      const sessions = await fetchAiConversations();
      setAiConversations(sessions);
    } catch (err) {
      console.error('Error loading AI conversations from R2:', err);
    } finally {
      setLoadingAiLogs(false);
    }
  };

  useEffect(() => {
    const cached = getCachedStoreData();
    applyStoreState(cached);

    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u || !u.email) {
        setIsAuthorizedAdmin(false);
        setLoading(false);
        return;
      }

      const normalizedEmail = u.email.toLowerCase();
      let authorized = ROOT_ADMIN_EMAILS.includes(normalizedEmail);

      try {
        const liveStore = await fetchLiveStoreData(true);
        applyStoreState(liveStore);
        if (!authorized) {
          authorized = (liveStore.admins || []).some(
            (a) => String(a.email || '').trim().toLowerCase() === normalizedEmail
          );
        }
      } catch {
        if (!authorized) {
          authorized = (cached.admins || []).some(
            (a) => String(a.email || '').trim().toLowerCase() === normalizedEmail
          );
        }
      }

      setIsAuthorizedAdmin(authorized);
      setLoading(false);
      if (authorized) {
        loadAiConversations();
      }
    });
    return () => unsub();
  }, []);

  // Multi-Admin Real-Time Sync: Automatically keeps all open Admin Dashboards in sync when any admin toggles $, L.L., Active/Hidden, Banner ON/OFF, or Corano AI
  useEffect(() => {
    if (!isAuthorizedAdmin) return;

    const syncLatestStoreIfChanged = async () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      try {
        const liveStore = await fetchLiveStoreData(true);
        if (
          typeof liveStore.version === 'number' &&
          liveStore.version !== lastStoreVersionRef.current
        ) {
          applyStoreState(liveStore);
        }
      } catch {
        // silent background sync
      }
    };

    const handleVisibilityOrFocus = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void syncLatestStoreIfChanged();
      }
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    const intervalId = window.setInterval(syncLatestStoreIfChanged, 15000);

    return () => {
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.clearInterval(intervalId);
    };
  }, [isAuthorizedAdmin]);

  const login = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      console.error(e);
    }
  };

  const logout = () => signOut(auth);

  // Global Store Currency Toggle Handler ($ USD <-> L.L. at 89,000)
  const handleToggleStoreCurrency = async (targetCurrency: StoreCurrency) => {
    if (targetCurrency === storeCurrency && !savingCurrency) return;
    setSavingCurrency(true);
    setStoreCurrency(targetCurrency);
    try {
      const updatedStore = await mutateR2StoreData('updateSettings', {
        currency: targetCurrency,
        exchangeRate: exchangeRate || DEFAULT_LBP_RATE,
        aiEnabled,
        aiBubbleLabel,
      });
      applyStoreState(updatedStore);
      setStatusNotice(
        targetCurrency === 'LBP'
          ? `✓ Website prices are now displayed in L.L. (${(exchangeRate || DEFAULT_LBP_RATE).toLocaleString()} L.L. = $1)`
          : '✓ Website prices are now displayed in $ (USD)'
      );
    } catch (err: any) {
      console.error('Failed to update store currency:', err);
      setStatusNotice(err?.message || 'Failed to update currency setting.');
    } finally {
      setSavingCurrency(false);
    }
  };

  // Toggle Corano AI Bubble ON / OFF on Main Website
  const handleToggleAiBubble = async (nextEnabled: boolean) => {
    if (nextEnabled === aiEnabled && !savingAiToggle) return;
    setSavingAiToggle(true);
    setAiEnabled(nextEnabled);
    try {
      const updatedStore = await mutateR2StoreData('updateSettings', {
        currency: storeCurrency,
        exchangeRate: exchangeRate || DEFAULT_LBP_RATE,
        aiEnabled: nextEnabled,
        aiBubbleLabel,
      });
      applyStoreState(updatedStore);
      setStatusNotice(
        nextEnabled
          ? '✓ Corano AI Bubble is now visible on the main website.'
          : '✓ Corano AI Bubble is now hidden on the main website.'
      );
    } catch (err: any) {
      console.error('Failed to toggle Corano AI bubble:', err);
      setStatusNotice(err?.message || 'Failed to update Corano AI visibility.');
    } finally {
      setSavingAiToggle(false);
    }
  };

  // Rename Outside AI Bubble Label on Main Website
  const handleSaveAiBubbleLabel = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = aiBubbleLabelDraft.trim().replace(/\s+/g, ' ').slice(0, 28) || 'Corano AI';
    setSavingAiLabel(true);
    setAiBubbleLabel(cleaned);
    setAiBubbleLabelDraft(cleaned);
    try {
      const updatedStore = await mutateR2StoreData('updateSettings', {
        currency: storeCurrency,
        exchangeRate: exchangeRate || DEFAULT_LBP_RATE,
        aiEnabled,
        aiBubbleLabel: cleaned,
      });
      applyStoreState(updatedStore);
      setStatusNotice(`✓ Corano AI name updated to "${cleaned}".`);
    } catch (err: any) {
      console.error('Failed to update AI bubble label:', err);
      setStatusNotice(err?.message || 'Failed to update AI bubble name.');
    } finally {
      setSavingAiLabel(false);
    }
  };

  // Export All AI Chats to Admin Device (.txt transcript & log report)
  const handleExportAiChats = () => {
    if (aiConversations.length === 0) {
      setStatusNotice('No AI chats available to export yet.');
      return;
    }

    const lines: string[] = [
      '==================================================',
      'CORANO RESTAURANT - AI INSIGHTS & GUEST LOGS',
      `Exported: ${new Date().toLocaleString('en-US')}`,
      `Total Conversations: ${aiConversations.length}`,
      '==================================================',
      '',
    ];

    aiConversations.forEach((session, idx) => {
      const dateStr = new Date(session.updatedAt || session.createdAt).toLocaleString('en-US');
      lines.push(
        `#${idx + 1} | Guest: ${session.guestName?.trim() || 'Guest'} | Date: ${dateStr}`
      );
      lines.push(
        `Topic: ${session.topicTag || 'General Menu'} | Language: ${session.language || 'English'}`
      );
      if (session.summary) {
        lines.push(`Summary: ${session.summary}`);
      }
      lines.push('--------------------------------------------------');
      for (const msg of session.messages || []) {
        const speaker =
          msg.role === 'user' ? `${session.guestName?.trim() || 'Guest'}` : 'Corano AI';
        lines.push(`[${speaker}]: ${msg.text}`);
        if (msg.role === 'assistant' && Array.isArray(msg.recommendedItemIds) && msg.recommendedItemIds.length > 0) {
          const recTitles = msg.recommendedItemIds
            .map((id) => items.find((i) => i.id === id)?.title || id)
            .join(', ');
          lines.push(`   -> Recommended Dishes: ${recTitles}`);
        }
      }
      lines.push('==================================================');
      lines.push('');
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `corano-ai-chats-${dateStamp}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setStatusNotice(`✓ Exported ${aiConversations.length} AI conversations to your device.`);
  };

  // Toggle Item In Stock / Out of Stock directly from Products List
  const handleToggleItemAvailability = async (item: MenuItem) => {
    const currentAvailable = item.available !== false;
    const nextAvailable = !currentAvailable;

    // Optimistic UI update
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, available: nextAvailable } : i))
    );

    try {
      const updatedStore = await mutateR2StoreData('toggleItemStock', {
        id: item.id,
        available: nextAvailable,
      });
      applyStoreState(updatedStore);
      setStatusNotice(
        nextAvailable
          ? `✓ "${item.title}" is now In Stock.`
          : `✓ "${item.title}" marked as Out of Stock.`
      );
    } catch (err) {
      console.error('Error toggling availability:', err);
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, available: currentAvailable } : i))
      );
      setStatusNotice('Failed to update stock status.');
    }
  };

  // Toggle Item Popular (★) directly from Products List
  const handleToggleItemPopular = async (item: MenuItem) => {
    const currentPopular = Boolean(item.popular);
    const nextPopular = !currentPopular;

    // Optimistic UI update
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, popular: nextPopular } : i))
    );

    try {
      const updatedStore = await mutateR2StoreData('toggleItemPopular', {
        id: item.id,
        popular: nextPopular,
      });
      applyStoreState(updatedStore);
      setStatusNotice(
        nextPopular
          ? `✓ "${item.title}" marked as ★ Popular.`
          : `✓ "${item.title}" removed from Popular.`
      );
    } catch (err) {
      console.error('Error toggling popular status:', err);
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, popular: currentPopular } : i))
      );
      setStatusNotice('Failed to update popular status.');
    }
  };

  // Photo Auto-Shrink + Live R2 Upload for Add New Item Form
  const handleAddFormPhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAddPhoto(true);
    setAddPhotoBadge(null);
    setStatusNotice(null);

    try {
      const compressed = await compressImageToBudget(file);
      const fileName = buildCollisionProofFileName(
        newItem.category || categories[0]?.name.toLowerCase() || 'subs',
        String(Date.now()),
        newItem.title || file.name.replace(/\.[^.]+$/, ''),
        compressed.extension
      );

      const previousUrl = newItem.img || '';
      const isSharedByExisting = items.some((i) => i.img === previousUrl);

      const uploaded = await uploadCompressedToR2({
        fileName,
        contentType: compressed.contentType,
        base64Data: compressed.base64Data,
        oldImageUrl: previousUrl || undefined,
        skipDeleteOld: isSharedByExisting,
      });

      setNewItem((prev) => ({ ...prev, img: uploaded.url }));
      setAddPhotoBadge(
        `✓ Shrunk ${compressed.originalSizeKB} KB → ${compressed.compressedSizeKB} KB`
      );
    } catch (err: any) {
      console.error('Add photo upload failed:', err);
      setStatusNotice(err?.message || 'Failed to upload photo.');
    } finally {
      setUploadingAddPhoto(false);
      if (addFileInputRef.current) addFileInputRef.current.value = '';
    }
  };

  // Photo Auto-Shrink + Live R2 Upload for Edit Item Modal
  const handleEditFormPhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editingItem) return;
    setUploadingEditPhoto(true);
    setEditPhotoBadge(null);
    setStatusNotice(null);

    try {
      const compressed = await compressImageToBudget(file);
      const uniqueToken = `${editingItem.id}-${Date.now().toString().slice(-5)}`;
      const fileName = buildCollisionProofFileName(
        editingItem.category || 'subs',
        uniqueToken,
        editingItem.title || file.name.replace(/\.[^.]+$/, ''),
        compressed.extension
      );

      const previousUrl = editingItem.img || '';
      const otherItemsSharingUrl = items.filter(
        (i) => i.id !== editingItem.id && i.img === previousUrl
      );

      const uploaded = await uploadCompressedToR2({
        fileName,
        contentType: compressed.contentType,
        base64Data: compressed.base64Data,
        oldImageUrl: previousUrl || undefined,
        skipDeleteOld: otherItemsSharingUrl.length > 0,
      });

      const finalDiscVal =
        editItemDiscountEnabled &&
        Number.isFinite(editItemDiscountValue) &&
        editItemDiscountValue > 0
          ? editItemDiscountType === 'percent'
            ? Math.min(99, Math.max(1, Math.round(editItemDiscountValue)))
            : Math.round(editItemDiscountValue * 100) / 100
          : 0;
      const finalDiscEnabled = Boolean(editItemDiscountEnabled && finalDiscVal > 0);

      const updatedItem: MenuItem = {
        ...editingItem,
        img: uploaded.url,
        discountEnabled: finalDiscEnabled,
        discountType: editItemDiscountType,
        discountValue: finalDiscVal,
      };
      setEditingItem(updatedItem);

      if (editingItem.id) {
        const updatedStore = await mutateR2StoreData('saveItem', {
          item: updatedItem,
        });
        applyStoreState(updatedStore);
      }

      setEditPhotoBadge(
        `✓ Shrunk ${compressed.originalSizeKB} KB → ${compressed.compressedSizeKB} KB`
      );
    } catch (err: any) {
      console.error('Edit photo upload failed:', err);
      setStatusNotice(err?.message || 'Failed to upload photo.');
    } finally {
      setUploadingEditPhoto(false);
      if (editFileInputRef.current) editFileInputRef.current.value = '';
    }
  };

  const openEditModal = (item: MenuItem) => {
    setEditPhotoBadge(null);
    setEditingItem(item);
    setEditItemInputCurrency('USD');
    setEditItemRawPriceInput(String(item.price || ''));

    const dType: PromoDiscountType = item.discountType === 'fixed' ? 'fixed' : 'percent';
    const dVal =
      typeof item.discountValue === 'number' &&
      Number.isFinite(item.discountValue) &&
      item.discountValue > 0
        ? item.discountValue
        : 0;
    const dEnabled = Boolean(item.discountEnabled && dVal > 0);
    setEditItemDiscountEnabled(dEnabled);
    setEditItemDiscountType(dType);
    setEditItemDiscountInputCurrency('USD');
    setEditItemDiscountValue(dVal);
    if (dVal > 0) {
      if (dType === 'percent') {
        setEditItemDiscountInput(String(Math.round(dVal)));
      } else {
        const cleanUsd = Math.round(dVal * 100) / 100;
        setEditItemDiscountInput(String(cleanUsd));
      }
    } else {
      setEditItemDiscountInput('');
    }
  };

  const parseZeroGlitchDiscountBox = (
    rawVal: string,
    discType: PromoDiscountType,
    inputCurr: StoreCurrency
  ): { inputStr: string; numericVal: number } => {
    const rate = exchangeRate || DEFAULT_LBP_RATE;
    if (discType === 'percent') {
      const digitsOnly = rawVal.replace(/[^0-9]/g, '').replace(/^0+/, '');
      if (digitsOnly === '') {
        return { inputStr: '', numericVal: 0 };
      }
      const parsed = Math.min(99, Math.max(1, parseInt(digitsOnly, 10)));
      return { inputStr: String(parsed), numericVal: parsed };
    }

    if (inputCurr === 'LBP') {
      const digitsOnly = rawVal.replace(/[^0-9]/g, '').replace(/^0+/, '');
      if (digitsOnly === '') {
        return { inputStr: '', numericVal: 0 };
      }
      const usdStr = convertLbpInputToUsdString(digitsOnly, rate);
      const usdVal = parseFloat(usdStr);
      return {
        inputStr: digitsOnly,
        numericVal: Number.isFinite(usdVal) && usdVal > 0 ? usdVal : 0,
      };
    }

    // USD mode: allow digits and at most one decimal point, preserving intermediate states like "0." or "5." while typing
    let cleaned = rawVal.replace(/[^0-9.]/g, '');
    const dotParts = cleaned.split('.');
    if (dotParts.length > 2) {
      cleaned = `${dotParts[0]}.${dotParts.slice(1).join('')}`;
    }
    if (cleaned.startsWith('.')) {
      cleaned = `0${cleaned}`;
    } else if (/^0+\d/.test(cleaned)) {
      cleaned = cleaned.replace(/^0+/, '');
    }
    if (cleaned === '') {
      return { inputStr: '', numericVal: 0 };
    }
    const parsedUsd = parseFloat(cleaned);
    return {
      inputStr: cleaned,
      numericVal:
        Number.isFinite(parsedUsd) && parsedUsd > 0 ? Math.round(parsedUsd * 100) / 100 : 0,
    };
  };

  // Add Product Modal Discount Handlers
  const handleNewItemDiscountInputChange = (rawVal: string) => {
    const { inputStr, numericVal } = parseZeroGlitchDiscountBox(
      rawVal,
      newItemDiscountType,
      newItemDiscountInputCurrency
    );
    setNewItemDiscountInput(inputStr);
    setNewItemDiscountValue(numericVal);
  };

  const handleSwitchNewItemDiscountType = (nextType: PromoDiscountType) => {
    if (nextType === newItemDiscountType) return;
    setNewItemDiscountType(nextType);
    setNewItemDiscountValue(0);
    setNewItemDiscountInput('');
  };

  const handleSwitchNewItemDiscountInputCurrency = (nextCurr: StoreCurrency) => {
    if (nextCurr === newItemDiscountInputCurrency) return;
    const rate = exchangeRate || DEFAULT_LBP_RATE;
    if (newItemDiscountValue > 0) {
      if (nextCurr === 'LBP') {
        setNewItemDiscountInput(
          convertUsdStringToLbpInput(String(newItemDiscountValue), rate)
        );
      } else {
        const cleanUsd = Math.round(newItemDiscountValue * 100) / 100;
        setNewItemDiscountInput(String(cleanUsd));
      }
    } else {
      setNewItemDiscountInput('');
    }
    setNewItemDiscountInputCurrency(nextCurr);
  };

  // Edit Product Modal Discount Handlers
  const handleEditItemDiscountInputChange = (rawVal: string) => {
    const { inputStr, numericVal } = parseZeroGlitchDiscountBox(
      rawVal,
      editItemDiscountType,
      editItemDiscountInputCurrency
    );
    setEditItemDiscountInput(inputStr);
    setEditItemDiscountValue(numericVal);
  };

  const handleSwitchEditItemDiscountType = (nextType: PromoDiscountType) => {
    if (nextType === editItemDiscountType) return;
    setEditItemDiscountType(nextType);
    setEditItemDiscountValue(0);
    setEditItemDiscountInput('');
  };

  const handleSwitchEditItemDiscountInputCurrency = (nextCurr: StoreCurrency) => {
    if (nextCurr === editItemDiscountInputCurrency) return;
    const rate = exchangeRate || DEFAULT_LBP_RATE;
    if (editItemDiscountValue > 0) {
      if (nextCurr === 'LBP') {
        setEditItemDiscountInput(
          convertUsdStringToLbpInput(String(editItemDiscountValue), rate)
        );
      } else {
        const cleanUsd = Math.round(editItemDiscountValue * 100) / 100;
        setEditItemDiscountInput(String(cleanUsd));
      }
    } else {
      setEditItemDiscountInput('');
    }
    setEditItemDiscountInputCurrency(nextCurr);
  };

  const handleSwitchNewItemInputCurrency = (mode: StoreCurrency) => {
    if (mode === newItemInputCurrency) return;
    if (mode === 'LBP') {
      const lbpStr = convertUsdStringToLbpInput(newItemRawPriceInput, exchangeRate);
      setNewItemRawPriceInput(lbpStr);
    } else {
      const usdStr = convertLbpInputToUsdString(newItemRawPriceInput, exchangeRate);
      setNewItemRawPriceInput(usdStr);
    }
    setNewItemInputCurrency(mode);
  };

  const handleSwitchEditItemInputCurrency = (mode: StoreCurrency) => {
    if (mode === editItemInputCurrency) return;
    if (mode === 'LBP') {
      const lbpStr = convertUsdStringToLbpInput(editItemRawPriceInput, exchangeRate);
      setEditItemRawPriceInput(lbpStr);
    } else {
      const usdStr = convertLbpInputToUsdString(editItemRawPriceInput, exchangeRate);
      setEditItemRawPriceInput(usdStr);
    }
    setEditItemInputCurrency(mode);
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusNotice(null);
    try {
      const finalUsdPrice =
        newItemInputCurrency === 'LBP'
          ? convertLbpInputToUsdString(newItemRawPriceInput, exchangeRate)
          : newItemRawPriceInput.replace(/^\$/, '').trim();

      const finalDiscVal =
        newItemDiscountEnabled &&
        Number.isFinite(newItemDiscountValue) &&
        newItemDiscountValue > 0
          ? newItemDiscountType === 'percent'
            ? Math.min(99, Math.max(1, Math.round(newItemDiscountValue)))
            : Math.round(newItemDiscountValue * 100) / 100
          : 0;
      const finalDiscEnabled = Boolean(newItemDiscountEnabled && finalDiscVal > 0);

      const payload = sanitizeFirestorePayload({
        category: (newItem.category || categories[0]?.name.toLowerCase() || 'subs').toLowerCase(),
        title: newItem.title || '',
        price: finalUsdPrice || '0',
        desc: newItem.desc || '',
        img: newItem.img || '',
        available: newItem.available !== false,
        popular: Boolean(newItem.popular),
        order: newItem.order ?? 99,
        discountEnabled: finalDiscEnabled,
        discountType: newItemDiscountType,
        discountValue: finalDiscVal,
      });

      const updatedStore = await mutateR2StoreData('saveItem', {
        item: payload,
      });
      applyStoreState(updatedStore);

      setNewItem({
        category: categories[0]?.name.toLowerCase() || 'subs',
        title: '',
        desc: '',
        price: '',
        img: '',
        available: true,
        popular: false,
        order: 99,
      });
      setNewItemRawPriceInput('');
      setNewItemDiscountEnabled(false);
      setNewItemDiscountType('percent');
      setNewItemDiscountInputCurrency('USD');
      setNewItemDiscountValue(0);
      setNewItemDiscountInput('');
      setAddPhotoBadge(null);
      setShowAddProductModal(false);
      setStatusNotice('✓ Product added to menu.');
    } catch (e: any) {
      console.error(e);
      setStatusNotice(e?.message || 'Error adding item.');
    }
  };

  const handleUpdateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem || !editingItem.id) return;
    setStatusNotice(null);
    try {
      const finalUsdPrice =
        editItemInputCurrency === 'LBP'
          ? convertLbpInputToUsdString(editItemRawPriceInput, exchangeRate)
          : editItemRawPriceInput.replace(/^\$/, '').trim();

      const finalDiscVal =
        editItemDiscountEnabled &&
        Number.isFinite(editItemDiscountValue) &&
        editItemDiscountValue > 0
          ? editItemDiscountType === 'percent'
            ? Math.min(99, Math.max(1, Math.round(editItemDiscountValue)))
            : Math.round(editItemDiscountValue * 100) / 100
          : 0;
      const finalDiscEnabled = Boolean(editItemDiscountEnabled && finalDiscVal > 0);

      const itemPayload = {
        ...editingItem,
        price: finalUsdPrice || editingItem.price || '0',
        category: editingItem.category.toLowerCase(),
        discountEnabled: finalDiscEnabled,
        discountType: editItemDiscountType,
        discountValue: finalDiscVal,
      };
      const updatedStore = await mutateR2StoreData('saveItem', {
        item: itemPayload,
      });
      applyStoreState(updatedStore);
      setEditingItem(null);
      setEditPhotoBadge(null);
      setStatusNotice('✓ Product updated.');
    } catch (e: any) {
      console.error(e);
      setStatusNotice(e?.message || 'Error updating item.');
    }
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const parsedOrder = parseCategoryOrder(newCatOrderInput, categories.length + 1);
      const updatedStore = await mutateR2StoreData('saveCategory', {
        category: {
          name: (newCat.name || '').trim(),
          order: parsedOrder,
        },
      });
      applyStoreState(updatedStore);
      const nextDefaultOrder = (updatedStore.categories?.length || categories.length) + 1;
      setNewCat({ name: '', order: nextDefaultOrder });
      setNewCatOrderInput(String(nextDefaultOrder));
      setShowAddCategoryModal(false);
      setStatusNotice('✓ Category added.');
    } catch (e: any) {
      console.error(e);
      setStatusNotice(e?.message || 'Error adding category.');
    }
  };

  const openEditCategoryModal = (cat: MenuCategory) => {
    setEditingCategory({ ...cat });
    setEditCatOrderInput(String(cat.order ?? ''));
  };

  const handleUpdateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCategory || !editingCategory.name.trim()) return;
    try {
      const previousCat = categories.find((c) => c.id === editingCategory.id);
      const parsedOrder = parseCategoryOrder(editCatOrderInput, editingCategory.order ?? 1);
      const updatedStore = await mutateR2StoreData('saveCategory', {
        category: {
          id: editingCategory.id,
          name: editingCategory.name.trim(),
          order: parsedOrder,
        },
      });
      applyStoreState(updatedStore);
      if (
        previousCat &&
        selectedQuickCategory.toLowerCase() === previousCat.name.toLowerCase()
      ) {
        setSelectedQuickCategory(editingCategory.name.trim().toLowerCase());
      }
      setEditingCategory(null);
      setStatusNotice('✓ Category updated.');
    } catch (e: any) {
      console.error(e);
      setStatusNotice(e?.message || 'Error updating category.');
    }
  };

  const handleAddReview = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const updatedStore = await mutateR2StoreData('addAdminReview', {
        review: {
          author: newReview.author || '',
          text: newReview.text || '',
          rating: newReview.rating || 5,
          date: new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          }),
          status: 'approved',
        },
      });
      applyStoreState(updatedStore);
      setNewReview({ author: '', text: '', rating: 5 });
      setStatusNotice('✓ Review added.');
    } catch (e: any) {
      console.error(e);
      setStatusNotice(e?.message || 'Error adding review.');
    }
  };

  const handleApproveReview = async (id: string) => {
    try {
      const updatedStore = await mutateR2StoreData('updateReviewStatus', {
        id,
        status: 'approved',
      });
      applyStoreState(updatedStore);
      setStatusNotice('✓ Review approved.');
    } catch (e: any) {
      console.error(e);
      setStatusNotice(e?.message || 'Error approving review.');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirm) return;
    setIsDeleting(true);
    try {
      if (deleteConfirm.type === 'item') {
        const updatedStore = await mutateR2StoreData('deleteItem', { id: deleteConfirm.id });
        applyStoreState(updatedStore);
        setStatusNotice(`✓ Deleted product "${deleteConfirm.label}".`);
      } else if (deleteConfirm.type === 'category') {
        const updatedStore = await mutateR2StoreData('deleteCategory', { id: deleteConfirm.id });
        applyStoreState(updatedStore);
        setStatusNotice(`✓ Deleted category "${deleteConfirm.label}".`);
      } else if (deleteConfirm.type === 'review') {
        const updatedStore = await mutateR2StoreData('deleteReview', { id: deleteConfirm.id });
        applyStoreState(updatedStore);
        setStatusNotice(`✓ Deleted review by "${deleteConfirm.label}".`);
      } else if (deleteConfirm.type === 'ai_session') {
        const remaining = await deleteAiConversations({ id: deleteConfirm.id });
        setAiConversations(remaining);
        setStatusNotice('✓ Conversation deleted.');
      } else if (deleteConfirm.type === 'ai_clear_all') {
        const remaining = await deleteAiConversations({ clearAll: true });
        setAiConversations(remaining);
        setStatusNotice('✓ All AI conversations cleared.');
      } else if (deleteConfirm.type === 'admin_email') {
        const updatedStore = await mutateR2StoreData('removeAdminEmail', {
          email: deleteConfirm.id.toLowerCase(),
        });
        applyStoreState(updatedStore);
        setAdminStatusMsg(`✓ Removed ${deleteConfirm.label} from authorized admins.`);
        setStatusNotice(`✓ Removed admin "${deleteConfirm.label}".`);
      } else if (
        deleteConfirm.type === 'promo_banner' ||
        deleteConfirm.type === 'saved_promo_banner'
      ) {
        // Check if deleting an unsaved draft photo from the top editor
        if (
          deleteConfirm.type === 'promo_banner' &&
          hasUnsavedBannerDraft &&
          !editingBannerId
        ) {
          const draftUrl = promoBannerUrl;
          const usedInSaved = savedPromoBanners.some((b) => b.imgUrl === draftUrl);
          if (draftUrl && !usedInSaved) {
            try {
              await deleteImageFromR2(draftUrl);
            } catch (r2DelErr) {
              console.warn('Non-fatal warning deleting draft banner file:', r2DelErr);
            }
          }
          hasUnsavedBannerDraftRef.current = false;
          setHasUnsavedBannerDraft(false);
          setBannerPhotoBadge(null);
          const fallback =
            savedPromoBanners.find((b) => b.id === activePromoBannerId) ||
            savedPromoBanners[0] ||
            null;
          if (fallback) {
            const fDiscType: PromoDiscountType =
              fallback.discountType === 'fixed' ? 'fixed' : 'percent';
            const fDiscVal =
              typeof fallback.discountValue === 'number' && fallback.discountValue > 0
                ? fallback.discountValue
                : 0;
            editingBannerIdRef.current = fallback.id;
            setEditingBannerId(fallback.id);
            setPromoBannerUrl(fallback.imgUrl);
            setPromoBannerDelaySeconds(fallback.delaySeconds);
            setPromoBannerDelayInput(String(fallback.delaySeconds));
            setPromoBannerMaxPerDay(fallback.maxPerDay);
            setPromoBannerMaxInput(String(fallback.maxPerDay));
            setPromoBannerClickToMenu(fallback.clickToMenu);
            setPromoBannerTargetUrl(fallback.targetUrl || '/menu');
            setPromoBannerDiscountEnabled(Boolean(fallback.discountEnabled && fDiscVal > 0));
            setPromoBannerDiscountType(fDiscType);
            setPromoBannerDiscountValue(fDiscVal);
            setPromoBannerDiscountInput(
              fDiscVal > 0
                ? fDiscType === 'percent'
                  ? String(Math.round(fDiscVal))
                  : promoBannerDiscountInputCurrency === 'LBP'
                  ? convertUsdStringToLbpInput(String(fDiscVal), exchangeRate)
                  : String(fDiscVal)
                : ''
            );
            setBannerPhotoBadge(fallback.sizeBadge || null);
          } else {
            editingBannerIdRef.current = null;
            setEditingBannerId(null);
            setPromoBannerUrl('');
            setPromoBannerDiscountEnabled(false);
            setPromoBannerDiscountValue(0);
            setPromoBannerDiscountInput('');
          }
          setStatusNotice('✓ Unsaved banner draft removed from editor.');
          setDeleteConfirm(null);
          setIsDeleting(false);
          return;
        }

        const targetBanner =
          deleteConfirm.type === 'saved_promo_banner'
            ? savedPromoBanners.find((b) => b.id === deleteConfirm.id)
            : savedPromoBanners.find(
                (b) =>
                  (editingBannerId && b.id === editingBannerId) ||
                  (activePromoBannerId && b.id === activePromoBannerId) ||
                  b.imgUrl === promoBannerUrl
              );
        const imgUrlToDelete = targetBanner ? targetBanner.imgUrl : promoBannerUrl;
        const nextSavedList = targetBanner
          ? savedPromoBanners.filter((b) => b.id !== targetBanner.id)
          : savedPromoBanners.filter((b) => b.imgUrl !== promoBannerUrl);

        const stillUsedByAnotherSaved = nextSavedList.some((b) => b.imgUrl === imgUrlToDelete);
        if (imgUrlToDelete && !stillUsedByAnotherSaved) {
          try {
            await deleteImageFromR2(imgUrlToDelete);
          } catch (r2DelErr) {
            console.warn('Non-fatal warning deleting banner file:', r2DelErr);
          }
        }

        const wasActiveLiveBanner =
          !targetBanner || targetBanner.id === activePromoBannerId;
        const remainingActiveBanner = wasActiveLiveBanner
          ? null
          : nextSavedList.find((b) => b.id === activePromoBannerId) || null;

        const nextActiveId = remainingActiveBanner ? remainingActiveBanner.id : '';
        const nextLiveUrl = remainingActiveBanner ? remainingActiveBanner.imgUrl : '';
        const nextDelay = remainingActiveBanner
          ? remainingActiveBanner.delaySeconds
          : promoBannerDelaySeconds;
        const nextMax = remainingActiveBanner
          ? remainingActiveBanner.maxPerDay
          : promoBannerMaxPerDay;
        const nextClick = remainingActiveBanner
          ? remainingActiveBanner.clickToMenu
          : promoBannerClickToMenu;
        const nextTarget = remainingActiveBanner
          ? remainingActiveBanner.targetUrl
          : promoBannerTargetUrl || '/menu';
        const nextDiscEnabled = remainingActiveBanner
          ? Boolean(remainingActiveBanner.discountEnabled && (remainingActiveBanner.discountValue || 0) > 0)
          : false;
        const nextDiscType: PromoDiscountType = remainingActiveBanner
          ? remainingActiveBanner.discountType === 'fixed'
            ? 'fixed'
            : 'percent'
          : 'percent';
        const nextDiscVal = remainingActiveBanner
          ? remainingActiveBanner.discountValue || 0
          : 0;

        const nextEditorFallback =
          editingBannerId && targetBanner && editingBannerId !== targetBanner.id
            ? nextSavedList.find((b) => b.id === editingBannerId) || nextSavedList[0] || null
            : nextSavedList[0] || null;

        const updatedStore = await mutateR2StoreData('updateSettings', {
          currency: storeCurrency,
          exchangeRate: exchangeRate || DEFAULT_LBP_RATE,
          aiEnabled,
          aiBubbleLabel,
          promoBannerEnabled,
          promoBannerUrl: nextLiveUrl,
          promoBannerDelaySeconds: nextDelay,
          promoBannerMaxPerDay: nextMax,
          promoBannerClickToMenu: nextClick,
          promoBannerTargetUrl: nextTarget,
          promoBannerDiscountEnabled: nextDiscEnabled,
          promoBannerDiscountType: nextDiscType,
          promoBannerDiscountValue: nextDiscVal,
          activePromoBannerId: nextActiveId,
          savedPromoBanners: nextSavedList,
        });
        applyStoreState(updatedStore, {
          clearDraft: true,
          syncEditorBannerId: nextEditorFallback ? nextEditorFallback.id : null,
        });
        setBannerPhotoBadge(null);
        setStatusNotice('✓ Promotional banner deleted.');
      }
      setDeleteConfirm(null);
    } catch (err: any) {
      console.error('Error deleting record:', err);
      setStatusNotice(err?.message || 'Failed to delete record.');
    } finally {
      setIsDeleting(false);
    }
  };

  const getReadableDestinationLabel = (targetUrl: string): string => {
    const clean = (targetUrl || '/menu').trim();
    if (!clean || clean === '/menu') return 'Whole Menu (/menu)';
    const parts = clean.replace(/^\/+/, '').split('/');
    if (parts[0] === 'menu' && parts.length === 2) {
      const cat = categories.find((c) => sanitizeSlug(c.name) === parts[1]);
      return cat ? `Category: ${cat.name}` : clean;
    }
    if (parts[0] === 'menu' && parts.length >= 3) {
      const item = items.find((it) => sanitizeSlug(it.title) === parts[2]);
      return item ? `${item.title} · ${item.category}` : clean;
    }
    return clean;
  };

  // Upload or Replace Homepage Promo Banner in Editor Preview ONLY (Does NOT save to Save Banners until admin clicks "Save Banner")
  const handleBannerPhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isAddingNew = bannerUploadMode === 'new' || !editingBannerId;
    if (isAddingNew && savedPromoBanners.length >= 15) {
      setStatusNotice('You have reached the maximum of 15 saved banners. Please delete one first.');
      if (e.target) e.target.value = '';
      return;
    }

    setUploadingBannerPhoto(true);
    setBannerPhotoBadge('Optimizing & uploading...');
    try {
      const original = await readOriginalImageForBanner(file);
      const ext =
        original.contentType === 'image/png'
          ? 'png'
          : original.contentType === 'image/webp'
          ? 'webp'
          : original.contentType === 'image/avif'
          ? 'avif'
          : 'jpg';
      const fileName = `promo-banner-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;

      // Keep any existing saved banner image in R2 intact until the admin clicks "Save Banner"
      const prevDraftUrl =
        hasUnsavedBannerDraft && !savedPromoBanners.some((b) => b.imgUrl === promoBannerUrl)
          ? promoBannerUrl
          : undefined;

      const uploaded = await uploadCompressedToR2({
        fileName,
        contentType: original.contentType,
        base64Data: original.base64Data,
        oldImageUrl: prevDraftUrl,
        skipDeleteOld: !prevDraftUrl,
        isPromoBanner: true,
      });

      const sizeKb = original.sizeKB || Math.max(1, Math.round(original.sizeBytes / 1024));
      const badgeStr = `✓ Optimized (${original.originalSizeKB} KB → ${sizeKb} KB · ${original.extension.toUpperCase()})`;

      if (isAddingNew) {
        editingBannerIdRef.current = null;
        setEditingBannerId(null);
      }
      hasUnsavedBannerDraftRef.current = true;
      setHasUnsavedBannerDraft(true);
      setPromoBannerUrl(uploaded.url);
      setBannerPhotoBadge(badgeStr);
      setStatusNotice(
        '✓ Banner photo optimized & loaded in preview. Configure settings below and click "Save Banner" to save it to Save Banners.'
      );
    } catch (err: any) {
      console.error('Banner upload failed:', err);
      setBannerPhotoBadge(null);
      setStatusNotice(err?.message || 'Failed to upload promo banner.');
    } finally {
      setUploadingBannerPhoto(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleDelayInputChange = (rawVal: string) => {
    const digitsOnly = rawVal.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
    if (digitsOnly === '') {
      setPromoBannerDelayInput('');
      return;
    }
    const normalized = String(Math.min(60, parseInt(digitsOnly, 10)));
    setPromoBannerDelayInput(normalized);
    setPromoBannerDelaySeconds(Number(normalized));
  };

  const handleMaxPerDayInputChange = (rawVal: string) => {
    const digitsOnly = rawVal.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
    if (digitsOnly === '') {
      setPromoBannerMaxInput('');
      return;
    }
    const normalized = String(Math.min(20, parseInt(digitsOnly, 10)));
    setPromoBannerMaxInput(normalized);
    setPromoBannerMaxPerDay(Number(normalized));
  };

  // Zero-glitch number input handler for Promo Banner Discount (% or $ / L.L.)
  const handlePromoDiscountInputChange = (rawVal: string) => {
    const { inputStr, numericVal } = parseZeroGlitchDiscountBox(
      rawVal,
      promoBannerDiscountType,
      promoBannerDiscountInputCurrency
    );
    setPromoBannerDiscountInput(inputStr);
    setPromoBannerDiscountValue(numericVal);
  };

  const handleSwitchPromoDiscountType = (nextType: PromoDiscountType) => {
    if (nextType === promoBannerDiscountType) return;
    setPromoBannerDiscountType(nextType);
    setPromoBannerDiscountValue(0);
    setPromoBannerDiscountInput('');
  };

  const handleSwitchPromoDiscountInputCurrency = (nextCurr: StoreCurrency) => {
    if (nextCurr === promoBannerDiscountInputCurrency) return;
    const rate = exchangeRate || DEFAULT_LBP_RATE;
    if (promoBannerDiscountValue > 0) {
      if (nextCurr === 'LBP') {
        setPromoBannerDiscountInput(
          convertUsdStringToLbpInput(String(promoBannerDiscountValue), rate)
        );
      } else {
        const cleanUsd = Math.round(promoBannerDiscountValue * 100) / 100;
        setPromoBannerDiscountInput(
          Number.isInteger(cleanUsd) ? String(cleanUsd) : String(cleanUsd)
        );
      }
    } else {
      setPromoBannerDiscountInput('');
    }
    setPromoBannerDiscountInputCurrency(nextCurr);
  };

  // Master Active / Hidden Switch at Top of Promo Banner Card (Solely turns the live website pop-up banner feature ON or OFF)
  const handleToggleMainPromoBannerMaster = async (nextEnabled: boolean) => {
    setSavingBannerSettings(true);
    try {
      const currentOnBanner =
        (activePromoBannerId
          ? savedPromoBanners.find((b) => b.id === activePromoBannerId)
          : null) || null;

      const updatedStore = await mutateR2StoreData('updateSettings', {
        currency: storeCurrency,
        exchangeRate: exchangeRate || DEFAULT_LBP_RATE,
        aiEnabled,
        aiBubbleLabel,
        promoBannerEnabled: nextEnabled,
        promoBannerUrl: currentOnBanner ? currentOnBanner.imgUrl : '',
        promoBannerDelaySeconds: currentOnBanner
          ? currentOnBanner.delaySeconds
          : promoBannerDelaySeconds,
        promoBannerMaxPerDay: currentOnBanner
          ? currentOnBanner.maxPerDay
          : promoBannerMaxPerDay,
        promoBannerClickToMenu: currentOnBanner
          ? currentOnBanner.clickToMenu
          : promoBannerClickToMenu,
        promoBannerTargetUrl: currentOnBanner
          ? currentOnBanner.targetUrl || '/menu'
          : promoBannerTargetUrl || '/menu',
        promoBannerDiscountEnabled: currentOnBanner
          ? Boolean(currentOnBanner.discountEnabled && (currentOnBanner.discountValue || 0) > 0)
          : Boolean(promoBannerDiscountEnabled && promoBannerDiscountValue > 0),
        promoBannerDiscountType: currentOnBanner
          ? currentOnBanner.discountType || 'percent'
          : promoBannerDiscountType,
        promoBannerDiscountValue: currentOnBanner
          ? currentOnBanner.discountValue || 0
          : promoBannerDiscountValue,
        activePromoBannerId: currentOnBanner ? currentOnBanner.id : '',
        savedPromoBanners,
      });
      applyStoreState(updatedStore);
      setStatusNotice(
        nextEnabled
          ? currentOnBanner
            ? '✓ Promo Banner master switch set to Active (the ON banner in Save Banners is now live on the website).'
            : '✓ Promo Banner master switch set to Active. Toggle a banner ON in Save Banners (or Save Banner below) to display it on the website.'
          : '✓ Promo Banner master switch set to Hidden (no banner or promo discount will appear on the live website).'
      );
    } catch (err: any) {
      console.error('Failed to toggle master promo banner status:', err);
      setStatusNotice(err?.message || 'Failed to update promo banner status.');
    } finally {
      setSavingBannerSettings(false);
    }
  };

  // Save Banner Button: Saves the current editor banner + settings into "Save Banners" history
  const handleSavePromoBannerSettings = async () => {
    const cleanUrl = promoBannerUrl.trim();
    if (!cleanUrl) {
      setStatusNotice('Please upload a promo banner photo first before clicking Save Banner.');
      return;
    }
    setSavingBannerSettings(true);
    try {
      const parsedDelay =
        promoBannerDelayInput.trim() === '' ? 2 : parseInt(promoBannerDelayInput, 10);
      const parsedMax =
        promoBannerMaxInput.trim() === '' ? 2 : parseInt(promoBannerMaxInput, 10);
      const clampedDelay = Math.max(
        0,
        Math.min(60, Number.isFinite(parsedDelay) ? parsedDelay : promoBannerDelaySeconds)
      );
      const clampedMax = Math.max(
        0,
        Math.min(20, Number.isFinite(parsedMax) ? parsedMax : promoBannerMaxPerDay)
      );
      const cleanTarget = promoBannerTargetUrl.trim() || '/menu';

      const finalDiscVal =
        promoBannerDiscountEnabled &&
        Number.isFinite(promoBannerDiscountValue) &&
        promoBannerDiscountValue > 0
          ? promoBannerDiscountType === 'percent'
            ? Math.min(99, Math.max(1, Math.round(promoBannerDiscountValue)))
            : Math.round(promoBannerDiscountValue * 100) / 100
          : 0;
      const finalDiscEnabled = Boolean(promoBannerDiscountEnabled && finalDiscVal > 0);
      const finalDiscType: PromoDiscountType =
        promoBannerDiscountType === 'fixed' ? 'fixed' : 'percent';

      let nextSavedList = [...savedPromoBanners];
      let savedBannerId = editingBannerId || '';
      let nextActiveId = activePromoBannerId;

      const existingIdx = savedBannerId
        ? nextSavedList.findIndex((b) => b.id === savedBannerId)
        : -1;

      if (existingIdx >= 0) {
        const previousImgUrl = nextSavedList[existingIdx].imgUrl;
        nextSavedList[existingIdx] = {
          ...nextSavedList[existingIdx],
          imgUrl: cleanUrl,
          delaySeconds: clampedDelay,
          maxPerDay: clampedMax,
          clickToMenu: promoBannerClickToMenu,
          targetUrl: cleanTarget,
          discountEnabled: finalDiscEnabled,
          discountType: finalDiscType,
          discountValue: finalDiscVal,
          label: getReadableDestinationLabel(cleanTarget),
          sizeBadge: bannerPhotoBadge || nextSavedList[existingIdx].sizeBadge,
        };
        if (
          previousImgUrl &&
          previousImgUrl !== cleanUrl &&
          !nextSavedList.some((b) => b.imgUrl === previousImgUrl)
        ) {
          try {
            await deleteImageFromR2(previousImgUrl);
          } catch {
            // ignore non-fatal cleanup error
          }
        }
      } else {
        if (nextSavedList.length >= 15) {
          setStatusNotice(
            'You have reached the maximum of 15 saved banners in Save Banners. Please delete one first.'
          );
          setSavingBannerSettings(false);
          return;
        }
        savedBannerId = `banner-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const newEntry: SavedPromoBanner = {
          id: savedBannerId,
          label: getReadableDestinationLabel(cleanTarget),
          imgUrl: cleanUrl,
          delaySeconds: clampedDelay,
          maxPerDay: clampedMax,
          clickToMenu: promoBannerClickToMenu,
          targetUrl: cleanTarget,
          discountEnabled: finalDiscEnabled,
          discountType: finalDiscType,
          discountValue: finalDiscVal,
          sizeBadge: bannerPhotoBadge || undefined,
          createdAt: new Date().toISOString(),
        };
        nextSavedList = [newEntry, ...nextSavedList].slice(0, 15);
        // When saving a brand new banner, set it as the ON banner in Save Banners (turning any previous ON banner OFF)
        nextActiveId = savedBannerId;
      }

      // If no banner was ON yet, turn this saved banner ON in Save Banners
      if (!nextActiveId && nextSavedList.length === 1) {
        nextActiveId = savedBannerId;
      }

      const activeBannerInList =
        (nextActiveId ? nextSavedList.find((b) => b.id === nextActiveId) : null) || null;

      const updatedStore = await mutateR2StoreData('updateSettings', {
        currency: storeCurrency,
        exchangeRate: exchangeRate || DEFAULT_LBP_RATE,
        aiEnabled,
        aiBubbleLabel,
        promoBannerEnabled,
        promoBannerUrl: activeBannerInList ? activeBannerInList.imgUrl : '',
        promoBannerDelaySeconds: activeBannerInList
          ? activeBannerInList.delaySeconds
          : clampedDelay,
        promoBannerMaxPerDay: activeBannerInList
          ? activeBannerInList.maxPerDay
          : clampedMax,
        promoBannerClickToMenu: activeBannerInList
          ? activeBannerInList.clickToMenu
          : promoBannerClickToMenu,
        promoBannerTargetUrl: activeBannerInList
          ? activeBannerInList.targetUrl || '/menu'
          : cleanTarget,
        promoBannerDiscountEnabled: activeBannerInList
          ? Boolean(activeBannerInList.discountEnabled && (activeBannerInList.discountValue || 0) > 0)
          : false,
        promoBannerDiscountType: activeBannerInList
          ? activeBannerInList.discountType || 'percent'
          : finalDiscType,
        promoBannerDiscountValue: activeBannerInList
          ? activeBannerInList.discountValue || 0
          : 0,
        activePromoBannerId: activeBannerInList ? activeBannerInList.id : '',
        savedPromoBanners: nextSavedList,
      });

      applyStoreState(updatedStore, {
        clearDraft: true,
        syncEditorBannerId: savedBannerId,
      });
      const discSummary = finalDiscEnabled
        ? ` · ${formatDiscountBadgeText(
            finalDiscType,
            finalDiscVal,
            storeCurrency,
            exchangeRate || DEFAULT_LBP_RATE
          )}`
        : '';
      setStatusNotice(
        existingIdx >= 0
          ? `✓ Banner updated in Save Banners (${clampedDelay}s delay · ${
              clampedMax === 0 ? 'every visit' : `${clampedMax}x/day`
            } · ${getReadableDestinationLabel(cleanTarget)}${discSummary}).`
          : `✓ Banner saved to Save Banners (${clampedDelay}s delay · ${
              clampedMax === 0 ? 'every visit' : `${clampedMax}x/day`
            } · ${getReadableDestinationLabel(cleanTarget)}${discSummary}).`
      );
    } catch (err: any) {
      console.error('Failed to save promo banner:', err);
      setStatusNotice(err?.message || 'Failed to save promo banner.');
    } finally {
      setSavingBannerSettings(false);
    }
  };

  // Solely Toggle a Single Banner ON or OFF in "Save Banners" (Does NOT alter the main Active/Hidden master switch)
  const handleToggleSavedBanner = async (banner: SavedPromoBanner, turnOn: boolean) => {
    setSavingBannerSettings(true);
    try {
      const nextActiveId = turnOn ? banner.id : '';
      const bannerHasDiscount = Boolean(
        banner.discountEnabled && typeof banner.discountValue === 'number' && banner.discountValue > 0
      );
      const updatedStore = await mutateR2StoreData('updateSettings', {
        currency: storeCurrency,
        exchangeRate: exchangeRate || DEFAULT_LBP_RATE,
        aiEnabled,
        aiBubbleLabel,
        promoBannerEnabled,
        promoBannerUrl: turnOn ? banner.imgUrl : '',
        promoBannerDelaySeconds: banner.delaySeconds,
        promoBannerMaxPerDay: banner.maxPerDay,
        promoBannerClickToMenu: banner.clickToMenu,
        promoBannerTargetUrl: banner.targetUrl || '/menu',
        promoBannerDiscountEnabled: turnOn ? bannerHasDiscount : false,
        promoBannerDiscountType: banner.discountType === 'fixed' ? 'fixed' : 'percent',
        promoBannerDiscountValue: turnOn && bannerHasDiscount ? banner.discountValue || 0 : 0,
        activePromoBannerId: nextActiveId,
        savedPromoBanners,
      });
      applyStoreState(updatedStore, {
        syncEditorBannerId: turnOn ? banner.id : editingBannerId || banner.id,
      });
      setStatusNotice(
        turnOn
          ? promoBannerEnabled
            ? `✓ Banner turned ON and is now live on the website (${banner.delaySeconds}s delay · ${
                banner.maxPerDay === 0 ? 'every visit' : `${banner.maxPerDay}x/day`
              } · ${getReadableDestinationLabel(banner.targetUrl)}). All other saved banners are now OFF.`
            : `✓ Banner turned ON in Save Banners (all other saved banners are now OFF). Note: Main banner switch is currently Hidden.`
          : '✓ Banner turned OFF in Save Banners.'
      );
    } catch (err: any) {
      console.error('Failed to toggle saved banner:', err);
      setStatusNotice(err?.message || 'Failed to update saved banner state.');
    } finally {
      setSavingBannerSettings(false);
    }
  };

  // Load a Saved Banner into the Editor Form above and scroll smoothly to the editor
  const handleSelectSavedBannerForEdit = (banner: SavedPromoBanner) => {
    hasUnsavedBannerDraftRef.current = false;
    setHasUnsavedBannerDraft(false);
    editingBannerIdRef.current = banner.id;
    setEditingBannerId(banner.id);
    setPromoBannerUrl(banner.imgUrl);
    setPromoBannerDelaySeconds(banner.delaySeconds);
    setPromoBannerDelayInput(String(banner.delaySeconds));
    setPromoBannerMaxPerDay(banner.maxPerDay);
    setPromoBannerMaxInput(String(banner.maxPerDay));
    setPromoBannerClickToMenu(banner.clickToMenu);
    setPromoBannerTargetUrl(banner.targetUrl || '/menu');
    const bDiscType: PromoDiscountType =
      banner.discountType === 'fixed' ? 'fixed' : 'percent';
    const bDiscVal =
      typeof banner.discountValue === 'number' && banner.discountValue > 0
        ? banner.discountValue
        : 0;
    setPromoBannerDiscountEnabled(Boolean(banner.discountEnabled && bDiscVal > 0));
    setPromoBannerDiscountType(bDiscType);
    setPromoBannerDiscountValue(bDiscVal);
    const rate = exchangeRate || DEFAULT_LBP_RATE;
    setPromoBannerDiscountInput(
      bDiscVal > 0
        ? bDiscType === 'percent'
          ? String(Math.round(bDiscVal))
          : promoBannerDiscountInputCurrency === 'LBP'
          ? convertUsdStringToLbpInput(String(bDiscVal), rate)
          : String(bDiscVal)
        : ''
    );
    setBannerPhotoBadge(banner.sizeBadge || null);
    setStatusNotice(
      `✓ Loaded banner (${getReadableDestinationLabel(banner.targetUrl)}) into editor above. Adjust settings and click Save Banner.`
    );
    if (promoBannerEditorRef.current) {
      promoBannerEditorRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleAddAdminEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminStatusMsg(null);
    const normalized = newAdminEmail.trim().toLowerCase();
    if (!normalized || !normalized.includes('@')) {
      setAdminStatusMsg('Please enter a valid Gmail address.');
      return;
    }
    try {
      const updatedStore = await mutateR2StoreData('addAdminEmail', {
        email: normalized,
      });
      applyStoreState(updatedStore);
      setNewAdminEmail('');
      setAdminStatusMsg(`✓ Added ${normalized} as an authorized Admin.`);
    } catch (err: any) {
      console.error('Error adding admin email:', err);
      setAdminStatusMsg(err?.message || 'Failed to add admin email.');
    }
  };

  const handleRemoveAdminEmail = async (emailId: string) => {
    setAdminStatusMsg(null);
    try {
      const updatedStore = await mutateR2StoreData('removeAdminEmail', {
        email: emailId.toLowerCase(),
      });
      applyStoreState(updatedStore);
      setAdminStatusMsg(`Removed ${emailId} from dynamic admins.`);
    } catch (err: any) {
      console.error('Error removing admin email:', err);
      setAdminStatusMsg(err?.message || 'Failed to remove admin email.');
    }
  };


  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-background text-on-surface flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user || !isAuthorizedAdmin) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-6 bg-background text-center text-on-surface">
        <div className="bg-surface-container-low border border-outline-variant/40 p-8 rounded-3xl max-w-md w-full shadow-2xl">
          <AdminSvgIcon name="admin_panel_settings" className="text-6xl text-primary mb-4" />
          <h2 className="font-headline text-2xl font-bold mb-3">Corano Admin Access</h2>
          <p className="mb-8 text-sm text-on-surface-variant">
            Sign in with your authorized Admin Google account to manage products, categories, reviews, and store settings.
          </p>
          {user && !isAuthorizedAdmin && (
            <p className="mb-4 text-xs text-error">
              Signed in as {user.email}, which does not have admin access.
            </p>
          )}
          <div className="flex flex-col gap-3">
            <button
              onClick={login}
              className="bg-primary text-on-primary font-bold px-8 py-3.5 rounded-xl hover:bg-primary/90 active:scale-[0.98] transition-all"
            >
              Sign In with Google
            </button>
            {user && (
              <button
                onClick={logout}
                className="text-xs text-on-surface-variant hover:text-on-surface underline py-1"
              >
                Sign out of {user.email}
              </button>
            )}
            <Link to="/home" className="text-xs text-on-surface-variant hover:text-primary mt-2 py-1">
              ← Back to Restaurant Website
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Computed counts & filtered lists
  const itemCountsByCategory: Record<string, number> = {};
  for (const item of items) {
    const key = (item.category || '').toLowerCase();
    itemCountsByCategory[key] = (itemCountsByCategory[key] || 0) + 1;
  }

  const outOfStockCount = items.filter((i) => i.available === false).length;
  const pendingReviews = reviews.filter((r) => r.status === 'pending');
  const displaySidebarReviews =
    pendingReviews.length > 0 ? pendingReviews : reviews.slice(0, 5);

  const filteredItems = items
    .filter((i) => {
      const matchesSearch =
        !searchTerm.trim() ||
        (i.title || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (i.category || '').toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory =
        selectedQuickCategory === 'all' ||
        (i.category || '').toLowerCase() === selectedQuickCategory.toLowerCase();
      const matchesStock =
        stockFilterTab === 'all' || (stockFilterTab === 'out_of_stock' && i.available === false);
      return matchesSearch && matchesCategory && matchesStock;
    })
    .sort((a, b) => {
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      const aPop = a.popular ? 1 : 0;
      const bPop = b.popular ? 1 : 0;
      if (aPop !== bPop) return bPop - aPop;
      return (a.order ?? 99) - (b.order ?? 99);
    });

  // Computed Corano AI Analytics
  const totalAiQuestions = aiConversations.reduce(
    (sum, s) => sum + (s.messages || []).filter((m) => m.role === 'user').length,
    0
  );
  const topicCounts: Record<string, number> = {};
  const recommendedItemCounts: Record<string, number> = {};
  for (const session of aiConversations) {
    const tag = session.topicTag || 'General Menu';
    topicCounts[tag] = (topicCounts[tag] || 0) + 1;
    for (const msg of session.messages || []) {
      if (msg.role === 'assistant' && Array.isArray(msg.recommendedItemIds)) {
        for (const itemId of msg.recommendedItemIds) {
          recommendedItemCounts[itemId] = (recommendedItemCounts[itemId] || 0) + 1;
        }
      }
    }
  }
  const topTopics = Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const topRecommendedDishes = Object.entries(recommendedItemCounts)
    .map(([itemId, count]) => ({
      item: items.find((i) => i.id === itemId),
      count,
    }))
    .filter((entry): entry is { item: MenuItem; count: number } => Boolean(entry.item))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const sectionLabelMap: Record<AdminSection, string> = {
    dashboard: 'Overview',
    products: 'Products & Menu',
    categories: 'Categories',
    reviews: 'Customer Reviews',
    ai: 'Corano AI Waiter & Logs',
    settings: 'Settings & Admin Access',
  };

  const openNewProductSheet = () => {
    setAddPhotoBadge(null);
    setNewItem({
      category:
        selectedQuickCategory !== 'all'
          ? selectedQuickCategory
          : categories[0]?.name.toLowerCase() || 'subs',
      title: '',
      desc: '',
      price: '',
      img: '',
      available: true,
      popular: false,
      order: 99,
    });
    setNewItemInputCurrency(storeCurrency);
    setNewItemRawPriceInput('');
    setNewItemDiscountEnabled(false);
    setNewItemDiscountType('percent');
    setNewItemDiscountInputCurrency(storeCurrency);
    setNewItemDiscountValue(0);
    setNewItemDiscountInput('');
    setShowAddProductModal(true);
  };

  const openNewCategorySheet = () => {
    const nextOrder = categories.length + 1;
    setNewCat({ name: '', order: nextOrder });
    setNewCatOrderInput(String(nextOrder));
    setShowAddCategoryModal(true);
  };

  return (
    <div className="min-h-[100dvh] bg-background text-on-surface flex flex-col lg:flex-row w-full max-w-[100vw] overflow-x-hidden">
      {/* Sidebar Drawer Backdrop (Mobile, POS & Desktop) */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/75 backdrop-blur-xs z-50"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* Left Sidebar Slide-Over Drawer (Toggled via Menu/Burger Button on Mobile & Desktop) */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-surface-container-low border-r border-outline-variant/40 flex flex-col justify-between transition-transform duration-200 ${
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div>
          {/* Brand Logo Header */}
          <div className="px-7 pt-7 pb-6 flex items-center justify-between">
            <Link to="/home" className="inline-flex items-start group">
              <span className="font-headline text-3xl font-bold tracking-tight text-on-surface group-hover:text-primary transition-colors">
                Corano
              </span>
            </Link>
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(false)}
              aria-label="Close menu"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-on-surface-variant hover:text-on-surface -mr-2 cursor-pointer"
            >
              <AdminSvgIcon name="close" className="text-[24px]" />
            </button>
          </div>

          {/* Sidebar Navigation Links */}
          <nav className="mt-1 space-y-1">
            {(
              [
                { id: 'dashboard', label: 'Dashboard', icon: 'home' },
                { id: 'products', label: 'Products & Menu', icon: 'grid_view' },
                { id: 'categories', label: 'Categories', icon: 'folder' },
                {
                  id: 'reviews',
                  label: 'Customer Reviews',
                  icon: 'chat',
                  badgeCount: reviews.length,
                },
                {
                  id: 'ai',
                  label: 'Corano AI',
                  icon: 'auto_awesome',
                  badgeCount: aiConversations.length,
                },
                { id: 'settings', label: 'Settings', icon: 'settings' },
              ] as const
            ).map((navItem) => {
              const isActive = activeSection === navItem.id;
              return (
                <button
                  key={navItem.id}
                  type="button"
                  onClick={() => {
                    setActiveSection(navItem.id);
                    setMobileSidebarOpen(false);
                    if (navItem.id === 'ai') {
                      loadAiConversations();
                    }
                  }}
                  className={`w-full flex items-center justify-between px-7 py-3.5 text-sm font-medium transition-colors relative ${
                    isActive
                      ? 'bg-surface-container text-on-surface'
                      : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50'
                  }`}
                >
                  <div className="flex items-center gap-3.5">
                    <AdminSvgIcon
                      name={navItem.icon}
                      className={`text-[20px] ${
                        isActive ? 'text-primary' : 'text-primary/80'
                      }`}
                    />
                    <span className="whitespace-nowrap">{navItem.label}</span>
                  </div>

                  {'badgeCount' in navItem && typeof navItem.badgeCount === 'number' && (
                    <span className="text-xs font-mono tabular-nums bg-surface-container-high text-on-surface-variant px-2 py-0.5 rounded-full">
                      {navItem.badgeCount}
                    </span>
                  )}

                  {isActive && (
                    <span className="absolute right-0 top-1.5 bottom-1.5 w-1 rounded-l bg-primary" />
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Logout Link */}
        <div className="p-7 border-t border-outline-variant/30 space-y-3">
          <Link
            to="/menu"
            className="flex items-center gap-3 text-xs text-on-surface-variant hover:text-primary transition-colors py-1"
          >
            <AdminSvgIcon name="visibility" className="text-[18px]" />
            <span>View Public Menu</span>
          </Link>
          <button
            type="button"
            onClick={logout}
            className="w-full flex items-center gap-3 text-sm text-on-surface-variant hover:text-on-surface transition-colors pt-1"
          >
            <AdminSvgIcon name="logout" className="text-[20px]" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 max-w-full overflow-x-hidden pb-24 lg:pb-10">
        {/* Sticky Top App Bar (Optimized for iPhone/Android & Desktop) */}
        <header className="sticky top-0 z-30 h-16 lg:h-20 px-4 sm:px-6 lg:px-10 bg-background/95 backdrop-blur-md border-b border-outline-variant/30 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen((prev) => !prev)}
              aria-label="Toggle menu"
              className="min-w-[40px] min-h-[40px] rounded-xl bg-surface-container-low border border-outline-variant/40 flex items-center justify-center text-on-surface hover:border-primary active:scale-95 transition-all cursor-pointer"
            >
              <AdminSvgIcon name="menu" className="text-[20px]" />
            </button>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm truncate">
                <span className="font-headline font-bold text-primary">Corano</span>
                <span className="text-on-surface-variant">/</span>
                <span className="text-on-surface font-medium truncate">
                  {sectionLabelMap[activeSection]}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            {/* Desktop Search Input */}
            <div className="relative hidden md:block w-60 lg:w-72">
              <AdminSvgIcon
                name="search"
                className="text-[18px] text-on-surface-variant absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search products..."
                className="w-full bg-surface-container-low border border-outline-variant/40 rounded-xl pl-10 pr-4 py-2 text-sm text-on-surface placeholder-on-surface-variant/60 focus:outline-none focus:border-primary"
              />
            </div>

            {/* Store Currency Quick Toggle ($ USD | L.L.) */}
            <div
              className="flex items-center bg-surface-container-low border border-outline-variant/40 rounded-xl p-1"
              title="Toggle live website prices between $ (USD) and L.L. (89,000 L.L. per $1)"
            >
              <button
                type="button"
                disabled={savingCurrency}
                onClick={() => handleToggleStoreCurrency('USD')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold font-mono transition-colors whitespace-nowrap ${
                  storeCurrency === 'USD'
                    ? 'bg-primary text-on-primary'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                $
              </button>
              <button
                type="button"
                disabled={savingCurrency}
                onClick={() => handleToggleStoreCurrency('LBP')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold font-mono transition-colors whitespace-nowrap ${
                  storeCurrency === 'LBP'
                    ? 'bg-primary text-on-primary'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                L.L.
              </button>
            </div>

            {/* Admin Profile Dropdown */}
            <div className="relative pl-0.5">
              <button
                type="button"
                onClick={() => setShowAdminMenu((prev) => !prev)}
                className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-surface-container-low transition-colors cursor-pointer"
              >
                <div className="w-8 h-8 rounded-full bg-surface-container border border-outline-variant/50 flex items-center justify-center text-xs font-bold text-primary">
                  {user.email?.charAt(0).toUpperCase() || 'A'}
                </div>
                <div className="hidden xl:block text-left">
                  <div className="text-xs font-medium text-on-surface flex items-center gap-1 whitespace-nowrap">
                    <span>Admin (Main)</span>
                    <AdminSvgIcon
                      name="expand_more"
                      className={`text-[14px] text-on-surface-variant transition-transform ${
                        showAdminMenu ? 'rotate-180' : ''
                      }`}
                    />
                  </div>
                </div>
              </button>

              {showAdminMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowAdminMenu(false)}
                  />
                  <div className="absolute right-0 mt-2 w-60 rounded-2xl bg-surface-container border border-outline-variant/40 shadow-2xl py-2 z-50">
                    <div className="px-4 py-2.5 border-b border-outline-variant/30">
                      <p className="text-[11px] text-on-surface-variant">Signed in as</p>
                      <p className="text-xs font-mono font-semibold text-on-surface truncate mt-0.5">
                        {user.email}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAdminMenu(false);
                        logout();
                      }}
                      className="w-full px-4 py-2.5 text-left text-xs font-semibold text-error hover:bg-surface-container-high flex items-center gap-2.5 transition-colors cursor-pointer"
                    >
                      <AdminSvgIcon name="logout" className="text-[18px]" />
                      <span>Log out</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Main Scrollable Viewport */}
        <div className="flex-1 px-4 py-5 sm:px-6 lg:px-10 lg:py-8 max-w-[1400px] w-full min-w-0 overflow-x-hidden mx-auto space-y-6 lg:space-y-8">
          {statusNotice && (
            <div className="px-4 py-3 rounded-xl bg-surface-container-low border border-primary/50 text-xs sm:text-sm text-on-surface flex justify-between items-center gap-2">
              <span>{statusNotice}</span>
              <button
                type="button"
                onClick={() => setStatusNotice(null)}
                className="text-xs text-primary font-semibold hover:underline shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Welcome Header + Primary Action Buttons */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3.5">
            <div>
              <h1 className="text-xl sm:text-3xl font-semibold text-on-surface tracking-tight">
                Welcome Back, Admin!
              </h1>
              <p className="text-xs text-on-surface-variant mt-0.5 sm:hidden">
                Store Currency:{' '}
                <span className="text-primary font-mono font-semibold">
                  {storeCurrency === 'LBP' ? 'L.L. (89,000/$1)' : '$ USD'}
                </span>
              </p>
            </div>

            {(activeSection === 'dashboard' ||
              activeSection === 'products' ||
              activeSection === 'categories') && (
              <div className="grid grid-cols-2 sm:flex items-center gap-2.5 sm:gap-3">
                <button
                  type="button"
                  onClick={openNewProductSheet}
                  className="bg-primary hover:bg-primary/90 active:scale-[0.98] text-on-primary font-bold px-4 py-3 sm:py-2.5 rounded-xl text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-all whitespace-nowrap shadow-md"
                >
                  <AdminSvgIcon name="add" className="text-[18px]" />
                  <span>Add Product</span>
                </button>
                <button
                  type="button"
                  onClick={openNewCategorySheet}
                  className="bg-surface-container-low hover:bg-surface-container active:scale-[0.98] text-primary border border-primary/60 font-semibold px-4 py-3 sm:py-2.5 rounded-xl text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-all whitespace-nowrap"
                >
                  <AdminSvgIcon name="add" className="text-[18px]" />
                  <span>Add Category</span>
                </button>
              </div>
            )}
          </div>

          {/* Mobile Search Bar (Shown on Dashboard & Products views on mobile/tablet) */}
          {(activeSection === 'dashboard' || activeSection === 'products') && (
            <div className="md:hidden">
              <div className="relative">
                <AdminSvgIcon
                  name="search"
                  className="text-[18px] text-on-surface-variant absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search products or categories..."
                  className="w-full bg-surface-container-low border border-outline-variant/40 rounded-xl pl-10 pr-9 py-2.5 text-base sm:text-sm text-on-surface placeholder-on-surface-variant/60 focus:outline-none focus:border-primary"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface"
                  >
                    <AdminSvgIcon name="close" className="text-[18px]" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* DASHBOARD OVERVIEW & PRODUCTS VIEW */}
          {(activeSection === 'dashboard' || activeSection === 'products') && (
            <>
              {/* Quick Categories Strip */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm sm:text-base font-semibold text-on-surface">
                    Quick Categories
                  </h2>
                  {selectedQuickCategory !== 'all' && (
                    <button
                      type="button"
                      onClick={() => setSelectedQuickCategory('all')}
                      className="text-xs text-primary font-semibold hover:underline"
                    >
                      Show All ({items.length})
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2.5 sm:gap-3 overflow-x-auto hide-scrollbar pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
                  {categories.map((cat) => {
                    const catKey = cat.name.toLowerCase();
                    const count = itemCountsByCategory[catKey] || 0;
                    const isSelected = selectedQuickCategory === catKey;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() =>
                          setSelectedQuickCategory((prev) => (prev === catKey ? 'all' : catKey))
                        }
                        className={`px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-xl border flex items-center gap-2.5 transition-all shrink-0 active:scale-95 ${
                          isSelected
                            ? 'bg-surface-container border-primary text-on-surface shadow-sm'
                            : 'bg-surface-container-low border-outline-variant/40 text-on-surface hover:border-outline'
                        }`}
                      >
                        <AdminSvgIcon
                          name={getCategoryIconName(cat.name)}
                          className="text-[19px] text-primary"
                        />
                        <span className="text-xs sm:text-sm font-medium whitespace-nowrap">
                          {cat.name}
                        </span>
                        <span className="text-xs text-on-surface-variant font-mono tabular-nums">
                          ({count})
                        </span>
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    onClick={openNewCategorySheet}
                    title="Add Category"
                    className="w-10 h-10 rounded-full bg-surface-container-low border border-outline-variant/40 hover:border-primary flex items-center justify-center text-on-surface-variant hover:text-primary shrink-0 transition-colors"
                  >
                    <AdminSvgIcon name="add" className="text-[18px]" />
                  </button>
                </div>
              </div>

              {/* Main 2-Column Split: Products List + Pending Reviews (on Dashboard Overview) */}
              <div
                className={`grid gap-6 lg:gap-8 ${
                  activeSection === 'dashboard' ? 'lg:grid-cols-3' : 'grid-cols-1'
                }`}
              >
                {/* Left Column: Products List */}
                <div className={activeSection === 'dashboard' ? 'lg:col-span-2 min-w-0' : 'min-w-0'}>
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-base sm:text-lg font-semibold text-on-surface">
                      Products List
                    </h2>
                    <span className="text-xs text-on-surface-variant font-mono tabular-nums">
                      {filteredItems.length} of {items.length}
                    </span>
                  </div>

                  {/* Sub-tabs: All Products | Out of Stock */}
                  <div className="flex items-center gap-6 border-b border-outline-variant/30 mb-4">
                    <button
                      type="button"
                      onClick={() => setStockFilterTab('all')}
                      className={`pb-2.5 text-sm font-medium transition-colors relative ${
                        stockFilterTab === 'all'
                          ? 'text-primary font-semibold'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      All Products
                      {stockFilterTab === 'all' && (
                        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setStockFilterTab('out_of_stock')}
                      className={`pb-2.5 text-sm font-medium transition-colors relative flex items-center gap-1.5 ${
                        stockFilterTab === 'out_of_stock'
                          ? 'text-primary font-semibold'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      <span>Out of Stock</span>
                      {outOfStockCount > 0 && (
                        <span className="text-xs font-mono tabular-nums text-on-surface-variant">
                          ({outOfStockCount})
                        </span>
                      )}
                      {stockFilterTab === 'out_of_stock' && (
                        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                      )}
                    </button>
                  </div>

                  {/* Products Table / Mobile App Cards */}
                  <div className="bg-surface-container-low border border-outline-variant/30 rounded-2xl divide-y divide-outline-variant/25 overflow-hidden">
                    {filteredItems.length === 0 ? (
                      <div className="p-10 text-center text-sm text-on-surface-variant">
                        No products match the current filter.
                      </div>
                    ) : (
                      filteredItems.map((item) => {
                        const isAvailable = item.available !== false;
                        const hasItemDiscount = Boolean(
                          item.discountEnabled &&
                            typeof item.discountValue === 'number' &&
                            item.discountValue > 0
                        );
                        const itemDiscType: PromoDiscountType =
                          item.discountType === 'fixed' ? 'fixed' : 'percent';
                        const itemDiscVal =
                          typeof item.discountValue === 'number' ? item.discountValue : 0;
                        const itemDiscUsd = hasItemDiscount
                          ? computeDiscountedUsdPriceString(item.price, itemDiscType, itemDiscVal)
                          : item.price;
                        const itemBadgeLabel = hasItemDiscount
                          ? formatDiscountBadgeText(
                              itemDiscType,
                              itemDiscVal,
                              storeCurrency,
                              exchangeRate || DEFAULT_LBP_RATE
                            )
                          : '';
                        return (
                          <div
                            key={item.id}
                            className="p-3 sm:px-4 sm:py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3.5 hover:bg-surface-container/40 transition-colors"
                          >
                            {/* Top / Left: Thumbnail + Title & Category + Mobile Price */}
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <div className="w-11 h-11 sm:w-10 sm:h-10 rounded-xl bg-surface-container overflow-hidden shrink-0 border border-outline-variant/30">
                                {item.img ? (
                                  <img
                                    src={item.img}
                                    alt={item.title}
                                    loading="lazy"
                                    className={`w-full h-full object-cover ${
                                      !isAvailable ? 'opacity-40 grayscale' : ''
                                    }`}
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-on-surface-variant">
                                    <AdminSvgIcon name="restaurant" className="text-[18px]" />
                                  </div>
                                )}
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="text-[13px] sm:text-sm font-semibold text-on-surface leading-snug line-clamp-2 sm:truncate">
                                    {item.title}
                                  </div>
                                  {/* Price shown on top-right on phone for clean thumb-zone alignment */}
                                  <div className="sm:hidden flex flex-col items-end font-mono tabular-nums whitespace-nowrap shrink-0">
                                    {hasItemDiscount ? (
                                      <>
                                        <span className="text-[10px] text-on-surface-variant/75 line-through leading-tight">
                                          {formatStorePrice(item.price, storeCurrency, exchangeRate)}
                                        </span>
                                        <span className="text-xs font-bold text-primary leading-tight">
                                          {formatStorePrice(itemDiscUsd, storeCurrency, exchangeRate)}
                                        </span>
                                      </>
                                    ) : (
                                      <span className="text-xs font-bold text-primary">
                                        {formatStorePrice(item.price, storeCurrency, exchangeRate)}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="text-[11px] text-on-surface-variant capitalize flex flex-wrap items-center gap-1.5 mt-0.5">
                                  <span>{item.category}</span>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-mono tabular-nums">
                                    #{item.order ?? 99}
                                  </span>
                                  {hasItemDiscount && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="bg-error text-on-error font-bold text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full">
                                        {itemBadgeLabel}
                                      </span>
                                    </>
                                  )}
                                  {item.popular && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="text-primary font-semibold">★ Popular</span>
                                    </>
                                  )}
                                  {!isAvailable && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="text-error font-semibold">Out of Stock</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Desktop / POS Center: Compact Formatted Price ($ or L.L.) */}
                            <div className="hidden sm:flex flex-col items-end font-mono tabular-nums whitespace-nowrap shrink-0">
                              {hasItemDiscount ? (
                                <>
                                  <span className="text-[10px] text-on-surface-variant/75 line-through leading-tight">
                                    {formatStorePrice(item.price, storeCurrency, exchangeRate)}
                                  </span>
                                  <span className="text-xs lg:text-[13px] font-bold text-primary leading-tight">
                                    {formatStorePrice(itemDiscUsd, storeCurrency, exchangeRate)}
                                  </span>
                                </>
                              ) : (
                                <span className="text-xs lg:text-[13px] font-bold text-primary">
                                  {formatStorePrice(item.price, storeCurrency, exchangeRate)}
                                </span>
                              )}
                            </div>

                            {/* Bottom / Right: Stock Toggle Switch + Popular Star + Edit + Delete */}
                            <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-3 pt-2 sm:pt-0 border-t border-outline-variant/20 sm:border-0 shrink-0">
                              <button
                                type="button"
                                role="switch"
                                aria-checked={isAvailable}
                                onClick={() => handleToggleItemAvailability(item)}
                                className="flex items-center gap-2 py-1 pr-2 rounded-lg active:scale-95 transition-transform"
                                title={
                                  isAvailable
                                    ? 'In Stock (Tap to mark Out of Stock)'
                                    : 'Out of Stock (Tap to mark In Stock)'
                                }
                              >
                                <span
                                  className={`w-11 h-6 rounded-full p-0.5 transition-colors flex items-center ${
                                    isAvailable
                                      ? 'bg-primary justify-end'
                                      : 'bg-surface-container-high justify-start'
                                  }`}
                                >
                                  <span
                                    className={`w-5 h-5 rounded-full transition-transform ${
                                      isAvailable
                                        ? 'bg-on-primary'
                                        : 'bg-on-surface-variant/60'
                                    }`}
                                  />
                                </span>
                                <span
                                  className={`sm:hidden text-xs font-semibold ${
                                    isAvailable ? 'text-primary' : 'text-on-surface-variant'
                                  }`}
                                >
                                  {isAvailable ? 'In Stock' : 'Out of Stock'}
                                </span>
                              </button>

                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleToggleItemPopular(item)}
                                  title={
                                    item.popular
                                      ? 'Marked as Popular (Tap to remove)'
                                      : 'Mark as Popular (★)'
                                  }
                                  className={`min-w-[40px] min-h-[40px] sm:min-w-[36px] sm:min-h-[36px] flex items-center justify-center rounded-xl hover:bg-surface-container active:scale-95 transition-all ${
                                    item.popular
                                      ? 'text-primary'
                                      : 'text-on-surface-variant hover:text-primary'
                                  }`}
                                >
                                  <AdminSvgIcon
                                    name="star"
                                    filled={Boolean(item.popular)}
                                    className="text-[20px]"
                                  />
                                </button>

                                <button
                                  type="button"
                                  onClick={() => openEditModal(item)}
                                  title="Edit Product"
                                  className="min-w-[40px] min-h-[40px] sm:min-w-[36px] sm:min-h-[36px] flex items-center justify-center text-on-surface-variant hover:text-primary rounded-xl hover:bg-surface-container active:scale-95 transition-all"
                                >
                                  <AdminSvgIcon name="edit" className="text-[20px]" />
                                </button>

                                <button
                                  type="button"
                                  onClick={() =>
                                    setDeleteConfirm({
                                      type: 'item',
                                      id: item.id,
                                      label: item.title,
                                    })
                                  }
                                  title="Delete Product"
                                  className="min-w-[40px] min-h-[40px] sm:min-w-[36px] sm:min-h-[36px] flex items-center justify-center text-on-surface-variant hover:text-error rounded-xl hover:bg-surface-container active:scale-95 transition-all"
                                >
                                  <AdminSvgIcon name="delete" className="text-[20px]" />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Right Column: Pending Reviews (shown on Dashboard Overview) */}
                {activeSection === 'dashboard' && (
                  <div className="lg:col-span-1 space-y-6">
                    {/* Pending Reviews */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h2 className="text-base sm:text-lg font-semibold text-on-surface">
                          Pending Reviews{' '}
                          <span className="text-on-surface-variant font-normal font-mono tabular-nums">
                            ({pendingReviews.length})
                          </span>
                        </h2>
                        <button
                          type="button"
                          onClick={() => setActiveSection('reviews')}
                          className="text-xs text-primary font-semibold hover:underline"
                        >
                          View All
                        </button>
                      </div>

                    <div className="bg-surface-container-low border border-outline-variant/30 rounded-2xl divide-y divide-outline-variant/25 overflow-hidden">
                      {displaySidebarReviews.length === 0 ? (
                        <div className="p-8 text-center text-sm text-on-surface-variant">
                          No customer reviews yet.
                        </div>
                      ) : (
                        displaySidebarReviews.map((rev) => (
                          <div key={rev.id} className="p-5 space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="font-semibold text-sm text-on-surface">
                                {rev.author}
                              </div>
                              {rev.status === 'pending' && (
                                <span className="text-[11px] text-primary font-semibold">
                                  Pending
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-0.5 text-primary">
                              {[1, 2, 3, 4, 5].map((star) => (
                                <AdminSvgIcon
                                  key={star}
                                  name="star"
                                  filled={star <= (rev.rating || 5)}
                                  className="text-[15px]"
                                />
                              ))}
                            </div>
                            <p className="text-xs text-on-surface-variant leading-relaxed line-clamp-3">
                              {rev.text}
                            </p>
                            <div className="pt-2 flex items-center gap-6 text-xs font-bold">
                              {rev.status === 'pending' && (
                                <button
                                  type="button"
                                  onClick={() => handleApproveReview(rev.id)}
                                  className="text-primary hover:underline py-1"
                                >
                                  Approve
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  setDeleteConfirm({
                                    type: 'review',
                                    id: rev.id,
                                    label: rev.author,
                                  })
                                }
                                className="text-on-surface-variant hover:text-error transition-colors py-1"
                              >
                                {rev.status === 'pending' ? 'Reject' : 'Delete'}
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* CATEGORIES SECTION */}
          {activeSection === 'categories' && (
            <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
              <div className="md:col-span-1 bg-surface-container-low border border-outline-variant/30 p-5 sm:p-6 rounded-2xl h-fit">
                <h3 className="font-semibold mb-4 text-lg">Add New Category</h3>
                <form onSubmit={handleAddCategory} className="space-y-4">
                  <div>
                    <label className="block text-xs mb-1.5 text-on-surface-variant">
                      Category Name
                    </label>
                    <input
                      required
                      value={newCat.name || ''}
                      onChange={(e) => setNewCat({ ...newCat, name: e.target.value })}
                      className="w-full bg-surface-container border border-outline/40 rounded-xl px-3.5 py-2.5 text-base sm:text-sm text-on-surface focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1.5 text-on-surface-variant">
                      Order Number (e.g. 6, 5.5 or 5,5)
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      required
                      value={newCatOrderInput}
                      onChange={(e) => setNewCatOrderInput(e.target.value)}
                      placeholder="e.g. 6 or 5.5 or 5,5"
                      className="w-full bg-surface-container border border-outline/40 rounded-xl px-3.5 py-2.5 text-base sm:text-sm text-on-surface font-mono tabular-nums focus:outline-none focus:border-primary"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full bg-primary text-on-primary py-3 sm:py-2.5 rounded-xl text-sm font-bold hover:bg-primary/90 active:scale-[0.98] transition-all"
                  >
                    Add Category
                  </button>
                </form>
              </div>

              <div className="md:col-span-2 bg-surface-container-low border border-outline-variant/30 rounded-2xl divide-y divide-outline-variant/25 overflow-hidden">
                {categories.map((cat) => {
                  const count = itemCountsByCategory[cat.name.toLowerCase()] || 0;
                  return (
                    <div
                      key={cat.id}
                      className="px-4 sm:px-6 py-4 flex justify-between items-center hover:bg-surface-container/40"
                    >
                      <div className="flex items-center gap-3.5">
                        <button
                          type="button"
                          onClick={() => openEditCategoryModal(cat)}
                          title="Edit category number or name"
                          className="bg-surface-container hover:border-primary/60 text-primary min-w-[36px] px-2 h-9 flex items-center justify-center rounded-xl text-xs font-bold font-mono tabular-nums border border-outline-variant/30 transition-colors"
                        >
                          {cat.order}
                        </button>
                        <div>
                          <h4 className="font-semibold text-on-surface">{cat.name}</h4>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-on-surface-variant font-mono tabular-nums">
                              {count} products
                            </span>
                            <span aria-hidden="true" className="text-on-surface-variant text-xs">·</span>
                            <Link
                              to={`/menu/${sanitizeSlug(cat.name)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`View /menu/${sanitizeSlug(cat.name)}`}
                              className="text-[11px] font-mono text-primary/80 hover:text-primary hover:underline lowercase"
                            >
                              /menu/{sanitizeSlug(cat.name)}
                            </Link>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditCategoryModal(cat)}
                          title="Edit category"
                          className="min-w-[44px] min-h-[44px] flex items-center justify-center text-on-surface-variant hover:text-primary rounded-xl hover:bg-surface-container transition-colors"
                        >
                          <AdminSvgIcon name="edit" className="text-[20px]" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setDeleteConfirm({
                              type: 'category',
                              id: cat.id,
                              label: cat.name,
                            })
                          }
                          title="Delete category"
                          className="min-w-[44px] min-h-[44px] flex items-center justify-center text-on-surface-variant hover:text-error rounded-xl hover:bg-surface-container transition-colors"
                        >
                          <AdminSvgIcon name="delete" className="text-[20px]" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* CUSTOMER REVIEWS SECTION */}
          {activeSection === 'reviews' && (
            <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
              <div className="md:col-span-1 bg-surface-container-low border border-outline-variant/30 p-5 sm:p-6 rounded-2xl h-fit">
                <h3 className="font-semibold mb-4 text-lg">Add Manual Review</h3>
                <form onSubmit={handleAddReview} className="space-y-4">
                  <div>
                    <label className="block text-xs mb-1.5 text-on-surface-variant">
                      Author Name
                    </label>
                    <input
                      required
                      value={newReview.author || ''}
                      onChange={(e) => setNewReview({ ...newReview, author: e.target.value })}
                      className="w-full bg-surface-container border border-outline/40 rounded-xl px-3.5 py-2.5 text-base sm:text-sm text-on-surface focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1.5 text-on-surface-variant">
                      Rating (1-5)
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="5"
                      required
                      value={newReview.rating || 5}
                      onChange={(e) =>
                        setNewReview({ ...newReview, rating: parseInt(e.target.value) || 5 })
                      }
                      className="w-full bg-surface-container border border-outline/40 rounded-xl px-3.5 py-2.5 text-base sm:text-sm text-on-surface font-mono tabular-nums focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1.5 text-on-surface-variant">
                      Review Text
                    </label>
                    <textarea
                      required
                      rows={4}
                      value={newReview.text || ''}
                      onChange={(e) => setNewReview({ ...newReview, text: e.target.value })}
                      className="w-full bg-surface-container border border-outline/40 rounded-xl px-3.5 py-2.5 text-base sm:text-sm text-on-surface focus:outline-none focus:border-primary"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full bg-primary text-on-primary py-3 sm:py-2.5 rounded-xl text-sm font-bold hover:bg-primary/90 active:scale-[0.98] transition-all"
                  >
                    Add Review
                  </button>
                </form>
              </div>

              <div className="md:col-span-2 bg-surface-container-low border border-outline-variant/30 rounded-2xl divide-y divide-outline-variant/25 overflow-hidden">
                {reviews.map((review) => (
                  <div
                    key={review.id}
                    className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2.5">
                        <span className="font-semibold text-on-surface">{review.author}</span>
                        <span className="text-primary text-sm">★ {review.rating}</span>
                        {review.status === 'pending' && (
                          <span className="text-xs text-primary font-semibold">· Pending</span>
                        )}
                      </div>
                      <p className="text-sm text-on-surface-variant">{review.text}</p>
                      <div className="text-xs text-on-surface-variant/60">{review.date}</div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0 text-xs font-bold pt-2 sm:pt-0 border-t border-outline-variant/20 sm:border-0">
                      {review.status === 'pending' && (
                        <button
                          type="button"
                          onClick={() => handleApproveReview(review.id!)}
                          className="text-primary hover:underline py-1.5"
                        >
                          Approve
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setDeleteConfirm({
                            type: 'review',
                            id: review.id!,
                            label: review.author,
                          })
                        }
                        className="text-on-surface-variant hover:text-error py-1.5"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CORANO AI WAITER & CONVERSATION ANALYTICS SECTION */}
          {activeSection === 'ai' && (
            <div className="space-y-4 sm:space-y-6 min-w-0">
              {/* Top Analytics Bar & Actions (Optimized for All Phones, Tablets & Desktop) */}
              <div className="bg-surface-container-low border border-outline-variant/30 rounded-2xl p-4 sm:p-5 space-y-3.5 lg:space-y-0 lg:flex lg:items-center lg:justify-between lg:gap-4">
                {/* Title Row + Minimal Corano AI ON/OFF Switch on Mobile */}
                <div className="flex items-center justify-between gap-2.5 min-w-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      <AdminSvgIcon
                        name="auto_awesome"
                        className="text-primary text-[20px] sm:text-[22px] shrink-0"
                      />
                      <h2 className="text-sm sm:text-lg font-semibold text-on-surface truncate">
                        AI Insights & Guest Logs
                      </h2>
                    </div>
                    <p className="text-[11px] sm:text-xs text-on-surface-variant mt-0.5 truncate">
                      See what your guests are asking in real time.
                    </p>
                  </div>

                  {/* Minimal Corano AI ON/OFF Toggle (Mobile Top-Right) */}
                  <button
                    type="button"
                    disabled={savingAiToggle}
                    onClick={() => handleToggleAiBubble(!aiEnabled)}
                    className="lg:hidden shrink-0 flex items-center gap-2 bg-surface-container border border-outline-variant/40 rounded-full pl-2.5 pr-1.5 py-1 transition-colors cursor-pointer"
                  >
                    <span className="text-[11px] font-semibold text-on-surface whitespace-nowrap">
                      Corano AI
                    </span>
                    <span
                      className={`w-9 h-5 rounded-full p-0.5 flex items-center transition-colors ${
                        aiEnabled
                          ? 'bg-primary justify-end'
                          : 'bg-surface-container-high justify-start'
                      }`}
                    >
                      <span
                        className={`w-4 h-4 rounded-full transition-transform ${
                          aiEnabled ? 'bg-on-primary' : 'bg-on-surface-variant/70'
                        }`}
                      />
                    </span>
                  </button>
                </div>

                {/* Desktop Toggle + Mobile 3-Column Action Bar */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 shrink-0">
                  {/* Minimal Corano AI ON/OFF Toggle (Desktop) */}
                  <button
                    type="button"
                    disabled={savingAiToggle}
                    onClick={() => handleToggleAiBubble(!aiEnabled)}
                    className="hidden lg:flex items-center gap-2.5 bg-surface-container border border-outline-variant/40 hover:border-outline rounded-full pl-3.5 pr-2 py-1.5 transition-colors cursor-pointer"
                  >
                    <span className="text-xs font-semibold text-on-surface whitespace-nowrap">
                      Corano AI
                    </span>
                    <span className="text-[11px] font-mono font-bold text-primary">
                      {aiEnabled ? 'ON' : 'OFF'}
                    </span>
                    <span
                      className={`w-9 h-5 rounded-full p-0.5 flex items-center transition-colors ${
                        aiEnabled
                          ? 'bg-primary justify-end'
                          : 'bg-surface-container-high justify-start'
                      }`}
                    >
                      <span
                        className={`w-4 h-4 rounded-full ${
                          aiEnabled ? 'bg-on-primary' : 'bg-on-surface-variant/70'
                        }`}
                      />
                    </span>
                  </button>

                  {/* Perfectly Fitted 3-Button Bar on All Phone Screens */}
                  <div className="grid grid-cols-3 sm:flex items-center gap-2 w-full sm:w-auto">
                    <button
                      type="button"
                      disabled={loadingAiLogs}
                      onClick={loadAiConversations}
                      className="min-w-0 px-2 sm:px-3.5 py-2 rounded-xl bg-surface-container border border-outline-variant/40 text-xs font-semibold text-on-surface hover:border-primary flex items-center justify-center gap-1 transition-colors cursor-pointer"
                    >
                      <AdminSvgIcon
                        name="refresh"
                        className={`text-[15px] text-primary shrink-0 ${
                          loadingAiLogs ? 'animate-spin' : ''
                        }`}
                      />
                      <span className="truncate">Refresh</span>
                    </button>

                    <button
                      type="button"
                      disabled={aiConversations.length === 0}
                      onClick={handleExportAiChats}
                      className="min-w-0 px-2 sm:px-3.5 py-2 rounded-xl bg-surface-container border border-primary/40 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-40 flex items-center justify-center gap-1 transition-colors cursor-pointer"
                    >
                      <AdminSvgIcon name="download" className="text-[15px] shrink-0" />
                      <span className="truncate">Export</span>
                    </button>

                    <button
                      type="button"
                      disabled={aiConversations.length === 0}
                      onClick={() =>
                        setDeleteConfirm({
                          type: 'ai_clear_all',
                          id: 'all',
                          label: `all ${aiConversations.length} AI chats`,
                        })
                      }
                      className="min-w-0 px-2 sm:px-3.5 py-2 rounded-xl bg-surface-container border border-error/40 text-xs font-semibold text-error hover:bg-error/10 disabled:opacity-40 flex items-center justify-center gap-1 transition-colors cursor-pointer"
                    >
                      <AdminSvgIcon name="delete_sweep" className="text-[15px] shrink-0" />
                      <span className="truncate">Delete All</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Analytics Summary Grid (Compact 2x2 on Phones, 4 Columns on Desktop) */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
                <div className="bg-surface-container-low border border-outline-variant/30 rounded-2xl p-3.5 sm:p-5 min-w-0">
                  <div className="text-[11px] sm:text-xs text-on-surface-variant truncate">
                    Guest Sessions
                  </div>
                  <div className="text-xl sm:text-3xl font-bold text-primary font-mono tabular-nums mt-1">
                    {aiConversations.length}
                  </div>
                  <div className="text-[10px] sm:text-[11px] text-on-surface-variant/70 mt-0.5 truncate">
                    Saved chats
                  </div>
                </div>

                <div className="bg-surface-container-low border border-outline-variant/30 rounded-2xl p-3.5 sm:p-5 min-w-0">
                  <div className="text-[11px] sm:text-xs text-on-surface-variant truncate">
                    Questions Asked
                  </div>
                  <div className="text-xl sm:text-3xl font-bold text-on-surface font-mono tabular-nums mt-1">
                    {totalAiQuestions}
                  </div>
                  <div className="text-[10px] sm:text-[11px] text-on-surface-variant/70 mt-0.5 truncate">
                    Live menu Q&A
                  </div>
                </div>

                <div className="col-span-2 sm:col-span-1 bg-surface-container-low border border-outline-variant/30 rounded-2xl p-3.5 sm:p-5 min-w-0">
                  <div className="text-[11px] sm:text-xs text-on-surface-variant mb-2">
                    Most Spoken Topics
                  </div>
                  {topTopics.length === 0 ? (
                    <div className="text-xs text-on-surface-variant/60">No topics recorded yet</div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {topTopics.map(([topic, count]) => (
                        <span
                          key={topic}
                          className="text-[11px] bg-surface-container border border-outline-variant/40 text-on-surface px-2 py-0.5 rounded-lg font-medium flex items-center gap-1"
                        >
                          <span className="text-primary">✦</span>
                          <span className="truncate max-w-[140px]">{topic}</span>
                          <span className="font-mono text-primary font-bold">({count})</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="col-span-2 sm:col-span-1 bg-surface-container-low border border-outline-variant/30 rounded-2xl p-3.5 sm:p-5 min-w-0">
                  <div className="text-[11px] sm:text-xs text-on-surface-variant mb-2">
                    Most Recommended Dishes
                  </div>
                  {topRecommendedDishes.length === 0 ? (
                    <div className="text-xs text-on-surface-variant/60">
                      No dishes recommended yet
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {topRecommendedDishes.slice(0, 3).map(({ item, count }) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between text-xs gap-2"
                        >
                          <span className="text-on-surface truncate font-medium">{item.title}</span>
                          <span className="font-mono text-primary font-bold shrink-0">
                            {count}×
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Tamr-Style Guest Conversation Feed */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm sm:text-base font-semibold text-on-surface">
                    Recent Guest Conversations ({aiConversations.length})
                  </h3>
                </div>

                {loadingAiLogs && aiConversations.length === 0 ? (
                  <div className="bg-surface-container-low border border-outline-variant/30 rounded-2xl p-10 text-center text-sm text-on-surface-variant">
                    Loading AI conversations...
                  </div>
                ) : aiConversations.length === 0 ? (
                  <div className="bg-surface-container-low border border-outline-variant/30 rounded-2xl p-10 text-center space-y-2">
                    <AdminSvgIcon name="forum" className="text-4xl text-primary/70" />
                    <div className="text-sm font-semibold text-on-surface">
                      No AI waiter conversations yet
                    </div>
                    <p className="text-xs text-on-surface-variant max-w-md mx-auto">
                      When guests click the floating Corano AI bubble on the website and ask about dishes, ingredients, or recommendations, their conversations and insights will appear here.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {aiConversations.map((session) => {
                      const formattedTime = new Date(
                        session.updatedAt || session.createdAt
                      ).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      });

                      return (
                        <div
                          key={session.id}
                          className="bg-surface-container-low border border-outline-variant/35 rounded-2xl overflow-hidden shadow-md"
                        >
                          {/* Guest Name Header Bar Over Each Chat */}
                          <div className="px-4 sm:px-6 py-2.5 bg-[#141413] border-b border-outline-variant/25 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <AdminSvgIcon name="person" className="text-[17px] text-primary" />
                              <span className="text-xs sm:text-sm font-bold text-primary tracking-wide">
                                {session.guestName?.trim() || 'Guest'}
                              </span>
                            </div>
                            <span className="text-[11px] text-on-surface-variant font-mono">
                              {formattedTime}
                            </span>
                          </div>

                          {/* Top Tamr-Style Insight Banner */}
                          <div className="px-4 sm:px-6 py-3.5 bg-surface-container border-b border-outline-variant/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                            <div className="flex items-start sm:items-center gap-2 min-w-0">
                              <span className="text-primary text-sm shrink-0 mt-0.5 sm:mt-0">
                                ✦
                              </span>
                              <p className="text-xs sm:text-sm font-semibold text-on-surface leading-snug">
                                {session.summary || 'Guest asked about the Corano menu'}
                              </p>
                            </div>

                            <div className="flex items-center flex-wrap gap-2 shrink-0">
                              <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-md bg-primary/15 text-primary border border-primary/30">
                                {session.topicTag || 'General Menu'}
                              </span>
                              <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-surface-container-high text-on-surface-variant">
                                {session.language || 'English'}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setDeleteConfirm({
                                    type: 'ai_session',
                                    id: session.id,
                                    label: `${session.guestName ? `${session.guestName}: ` : ''}${session.summary || 'AI Conversation'}`,
                                  })
                                }
                                title="Delete conversation"
                                className="min-w-[32px] min-h-[32px] rounded-lg flex items-center justify-center text-on-surface-variant hover:text-error hover:bg-surface-container-high transition-colors cursor-pointer"
                              >
                                <AdminSvgIcon name="delete" className="text-[18px]" />
                              </button>
                            </div>
                          </div>

                          {/* Conversation Messages Thread */}
                          <div className="p-4 sm:p-6 space-y-3 bg-[#101010]/60">
                            {(session.messages || []).map((msg, mIdx) => {
                              const isUser = msg.role === 'user';
                              const recommendedDishes = (msg.recommendedItemIds || [])
                                .map((id) => items.find((i) => i.id === id))
                                .filter((item): item is MenuItem => Boolean(item));

                              return (
                                <div
                                  key={`${session.id}-${mIdx}`}
                                  className={`flex flex-col ${
                                    isUser ? 'items-end' : 'items-start'
                                  }`}
                                >
                                  <div
                                    className={`max-w-[90%] sm:max-w-[75%] rounded-2xl px-4 py-2.5 text-xs sm:text-sm leading-relaxed ${
                                      isUser
                                        ? 'bg-[#E4CD86] text-[#101010] font-semibold rounded-br-xs'
                                        : 'bg-surface-container border border-outline-variant/30 text-on-surface rounded-bl-xs'
                                    }`}
                                  >
                                    {msg.text}
                                  </div>

                                  {!isUser && recommendedDishes.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 mt-2">
                                      {recommendedDishes.map((dish) => (
                                        <span
                                          key={dish.id}
                                          className="inline-flex items-center gap-1.5 text-[11px] bg-surface-container-low border border-outline-variant/40 text-on-surface px-2.5 py-1 rounded-lg"
                                        >
                                          <AdminSvgIcon
                                            name="restaurant"
                                            className="text-[13px] text-primary"
                                          />
                                          <span className="font-medium">{dish.title}</span>
                                          <span className="font-mono text-primary">
                                            {formatStorePrice(
                                              dish.price,
                                              storeCurrency,
                                              exchangeRate
                                            )}
                                          </span>
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SETTINGS & ADMIN ACCESS MANAGER SECTION */}
          {activeSection === 'settings' && (
            <div className="space-y-6 min-w-0 max-w-full overflow-hidden">
              {/* 1. Homepage Promotional Banner Pop-Up Manager Card (First) */}
              <div
                ref={promoBannerEditorRef}
                className="bg-surface-container-low border border-outline-variant/30 rounded-2xl p-4 sm:p-6 space-y-5 scroll-mt-24 min-w-0 max-w-full overflow-hidden"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 min-w-0">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <AdminSvgIcon name="campaign" className="text-primary text-[22px] shrink-0" />
                      <h2 className="text-base sm:text-lg font-semibold text-on-surface">
                        Homepage Promotional Banner Pop-Up
                      </h2>
                      {(() => {
                        const hasOnBanner =
                          Boolean(activePromoBannerId) &&
                          savedPromoBanners.some((b) => b.id === activePromoBannerId);
                        const isLiveNow = promoBannerEnabled && hasOnBanner;
                        return (
                          <span
                            className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                              isLiveNow
                                ? 'bg-primary/20 text-primary border border-primary/40'
                                : 'bg-surface-container text-on-surface-variant border border-outline-variant/40'
                            }`}
                          >
                            {isLiveNow ? 'LIVE ON WEBSITE' : 'HIDDEN'}
                          </span>
                        );
                      })()}
                      {hasUnsavedBannerDraft && (
                        <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                          Unsaved Draft · Click Save Banner
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:flex items-center gap-1.5 bg-surface-container p-1 rounded-xl border border-outline-variant/50 shrink-0 w-full sm:w-auto">
                    <button
                      type="button"
                      disabled={savingBannerSettings || uploadingBannerPhoto}
                      onClick={() => {
                        setPromoBannerEnabled(true);
                        void handleToggleMainPromoBannerMaster(true);
                      }}
                      className={`px-4 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap active:scale-95 cursor-pointer disabled:opacity-50 ${
                        promoBannerEnabled
                          ? 'bg-primary text-on-primary shadow-sm'
                          : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/60'
                      }`}
                    >
                      Active
                    </button>
                    <button
                      type="button"
                      disabled={savingBannerSettings || uploadingBannerPhoto}
                      onClick={() => {
                        setPromoBannerEnabled(false);
                        void handleToggleMainPromoBannerMaster(false);
                      }}
                      className={`px-4 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap active:scale-95 cursor-pointer disabled:opacity-50 ${
                        !promoBannerEnabled
                          ? 'bg-surface-container-highest text-on-surface shadow-sm'
                          : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/60'
                      }`}
                    >
                      Hidden
                    </button>
                  </div>
                </div>

                {/* Banner Preview & Upload / Replace / Delete Controls */}
                <div className="grid md:grid-cols-12 gap-5 items-start pt-2 border-t border-outline-variant/30 min-w-0 max-w-full">
                  <div className="md:col-span-5 min-w-0 max-w-full flex flex-col items-center justify-center bg-surface-container border border-outline-variant/40 rounded-2xl p-4 min-h-[220px] overflow-hidden">
                    {promoBannerUrl ? (
                      <div className="w-full min-w-0 flex flex-col items-center gap-3">
                        <img
                          src={promoBannerUrl}
                          alt="Promotional Banner Preview"
                          className="max-h-[260px] max-w-full w-auto object-contain rounded-xl border border-primary/30 shadow-lg"
                        />
                        <div className="flex flex-wrap items-center justify-center gap-2 w-full">
                          <button
                            type="button"
                            disabled={uploadingBannerPhoto || savedPromoBanners.length >= 15}
                            onClick={() => {
                              setBannerUploadMode('new');
                              bannerFileInputRef.current?.click();
                            }}
                            className="flex-1 bg-primary text-on-primary px-3 py-2.5 rounded-xl text-xs font-bold hover:bg-primary/90 transition-colors disabled:opacity-50 whitespace-nowrap"
                          >
                            {uploadingBannerPhoto ? 'Uploading...' : '+ Upload New Banner'}
                          </button>
                          <button
                            type="button"
                            disabled={uploadingBannerPhoto}
                            onClick={() => {
                              setBannerUploadMode('replace');
                              bannerFileInputRef.current?.click();
                            }}
                            className="bg-surface-container-high hover:bg-surface-container-highest text-on-surface border border-outline-variant/40 px-3 py-2.5 rounded-xl text-xs font-bold transition-colors disabled:opacity-50 whitespace-nowrap"
                          >
                            Replace Photo
                          </button>
                          <button
                            type="button"
                            disabled={uploadingBannerPhoto || isDeleting}
                            onClick={() =>
                              setDeleteConfirm({
                                type: 'promo_banner',
                                id: editingBannerId || activePromoBannerId || 'promo-banner',
                                label: 'Promotional Banner',
                              })
                            }
                            className="bg-error/15 hover:bg-error/25 text-error border border-error/30 px-3 py-2.5 rounded-xl text-xs font-bold transition-colors disabled:opacity-50 whitespace-nowrap"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-6 px-3">
                        <AdminSvgIcon
                          name="add_photo_alternate"
                          className="text-4xl text-primary/70 mb-2"
                        />
                        <p className="text-xs text-on-surface font-medium mb-3">
                          No Promotional Banner Uploaded
                        </p>
                        <button
                          type="button"
                          disabled={uploadingBannerPhoto}
                          onClick={() => {
                            setBannerUploadMode('new');
                            bannerFileInputRef.current?.click();
                          }}
                          className="bg-primary text-on-primary px-5 py-2.5 rounded-xl text-xs font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
                        >
                          {uploadingBannerPhoto ? 'Uploading...' : 'Upload Banner Photo'}
                        </button>
                      </div>
                    )}
                    <input
                      ref={bannerFileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/avif"
                      onChange={handleBannerPhotoSelect}
                      className="hidden"
                    />
                    {bannerPhotoBadge && (
                      <div className="mt-2.5 text-[11px] font-mono text-primary text-center break-words max-w-full">
                        {bannerPhotoBadge}
                      </div>
                    )}
                  </div>

                  {/* Timing, Destination & Promotional Discount Controls */}
                  <div className="md:col-span-7 min-w-0 max-w-full space-y-4">
                    <div className="grid sm:grid-cols-2 gap-4 min-w-0">
                      <div className="bg-surface-container p-4 rounded-xl border border-outline-variant/30 min-w-0">
                        <label className="block text-xs font-semibold text-on-surface mb-1">
                          Pop-Up Delay After Entering (Seconds)
                        </label>
                        <p className="text-[11px] text-on-surface-variant mb-2.5">
                          How many seconds after a visitor lands on the website before the banner pops up (0–60s).
                        </p>
                        <div className="flex items-center gap-2 min-w-0">
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            placeholder="2"
                            value={promoBannerDelayInput}
                            onChange={(e) => handleDelayInputChange(e.target.value)}
                            onBlur={() => {
                              if (promoBannerDelayInput.trim() === '') {
                                setPromoBannerDelayInput(String(promoBannerDelaySeconds));
                              }
                            }}
                            className="w-24 bg-surface-container-low border border-outline/40 rounded-xl px-3 py-2 text-base sm:text-sm text-on-surface font-mono tabular-nums focus:outline-none focus:border-primary"
                          />
                          <span className="text-xs text-on-surface-variant font-mono">seconds</span>
                        </div>
                      </div>

                      <div className="bg-surface-container p-4 rounded-xl border border-outline-variant/30 min-w-0">
                        <label className="block text-xs font-semibold text-on-surface mb-1">
                          Max Pop-Ups Per IP / Visitor Per Day
                        </label>
                        <p className="text-[11px] text-on-surface-variant mb-2.5">
                          How many times per day the same visitor IP sees the pop-up (set 0 for every visit).
                        </p>
                        <div className="flex items-center gap-2 min-w-0">
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            placeholder="2"
                            value={promoBannerMaxInput}
                            onChange={(e) => handleMaxPerDayInputChange(e.target.value)}
                            onBlur={() => {
                              if (promoBannerMaxInput.trim() === '') {
                                setPromoBannerMaxInput(String(promoBannerMaxPerDay));
                              }
                            }}
                            className="w-24 bg-surface-container-low border border-outline/40 rounded-xl px-3 py-2 text-base sm:text-sm text-on-surface font-mono tabular-nums focus:outline-none focus:border-primary"
                          />
                          <span className="text-xs text-on-surface-variant font-mono truncate">
                            {promoBannerMaxPerDay === 0 ? 'unlimited / every visit' : 'times / day'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-surface-container p-4 rounded-xl border border-outline-variant/30 space-y-3 min-w-0 max-w-full overflow-hidden">
                      <div className="flex items-center justify-between gap-3 min-w-0">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-on-surface">
                            Tap Banner Image to Open Menu or Specific Dish
                          </div>
                          <div className="text-[11px] text-on-surface-variant mt-0.5">
                            When enabled, tapping directly on the promotional banner takes the customer to the selected menu destination.
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPromoBannerClickToMenu((prev) => !prev)}
                          className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors shrink-0 ${
                            promoBannerClickToMenu
                              ? 'bg-primary/20 border-primary text-primary'
                              : 'bg-surface-container-low border-outline-variant/40 text-on-surface-variant'
                          }`}
                        >
                          {promoBannerClickToMenu ? 'Enabled' : 'Disabled'}
                        </button>
                      </div>

                      {promoBannerClickToMenu && (
                        <div className="pt-3 border-t border-outline-variant/20 space-y-2.5 min-w-0 max-w-full">
                          <div className="min-w-0 max-w-full">
                            <div className="flex items-center justify-between gap-2 mb-1.5 min-w-0">
                              <label className="text-xs font-semibold text-on-surface">
                                Destination Link (Auto-Generated for All Categories & Dishes)
                              </label>
                              {bannerDestSearch && (
                                <button
                                  type="button"
                                  onClick={() => setBannerDestSearch('')}
                                  className="text-[11px] text-primary hover:underline font-medium shrink-0"
                                >
                                  Clear filter
                                </button>
                              )}
                            </div>

                            {/* Small search bar to quickly find any dish or category (text-base on mobile prevents iOS Safari auto-zoom) */}
                            <div className="relative flex items-center mb-2 min-w-0 max-w-full">
                              <svg
                                className="w-3.5 h-3.5 fill-current text-on-surface-variant absolute left-3 pointer-events-none shrink-0"
                                viewBox="0 -960 960 960"
                                aria-hidden="true"
                              >
                                <path d="M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z" />
                              </svg>
                              <input
                                type="text"
                                value={bannerDestSearch}
                                onChange={(e) => setBannerDestSearch(e.target.value)}
                                placeholder="Search category or dish (e.g. tawouk, burger, sub)..."
                                className="w-full min-w-0 max-w-full bg-surface-container-low border border-outline/40 rounded-xl pl-8 pr-8 py-2 sm:py-1.5 text-base sm:text-xs text-on-surface placeholder-on-surface-variant/60 focus:outline-none focus:border-primary"
                              />
                              {bannerDestSearch && (
                                <button
                                  type="button"
                                  onClick={() => setBannerDestSearch('')}
                                  aria-label="Clear destination search"
                                  className="absolute right-2 text-on-surface-variant hover:text-primary p-1"
                                >
                                  <svg className="w-3.5 h-3.5 fill-current shrink-0" viewBox="0 -960 960 960" aria-hidden="true">
                                    <path d="m256-214-42-42 224-224-224-224 42-42 224 224 224-224 42 42-224 224 224 224-42 42-224-224-224 224Z" />
                                  </svg>
                                </button>
                              )}
                            </div>

                            {/* If searching, display quick-select matches directly */}
                            {bannerDestSearch.trim() && (
                              <div className="max-h-40 overflow-y-auto overflow-x-hidden bg-surface-container-low border border-primary/30 rounded-xl p-1.5 mb-2 space-y-1 w-full min-w-0 max-w-full">
                                {(() => {
                                  const q = bannerDestSearch.toLowerCase().trim();
                                  const matchedCats = categories.filter((c) =>
                                    (c.name || '').toLowerCase().includes(q)
                                  );
                                  const matchedItems = items.filter(
                                    (it) =>
                                      (it.title || '').toLowerCase().includes(q) ||
                                      (it.category || '').toLowerCase().includes(q)
                                  );

                                  if (matchedCats.length === 0 && matchedItems.length === 0) {
                                    return (
                                      <div className="text-[11px] text-on-surface-variant text-center py-2">
                                        No category or dish matching "{bannerDestSearch.trim()}".
                                      </div>
                                    );
                                  }

                                  return (
                                    <>
                                      {matchedCats.map((cat) => {
                                        const url = `/menu/${sanitizeSlug(cat.name)}`;
                                        const isChosen = promoBannerTargetUrl === url;
                                        return (
                                          <button
                                            key={`match-cat-${cat.id}`}
                                            type="button"
                                            onClick={() => {
                                              setPromoBannerTargetUrl(url);
                                              setBannerDestSearch('');
                                            }}
                                            className={`w-full max-w-full text-left px-3 py-2 rounded-lg text-xs flex items-center gap-2 transition-colors min-w-0 overflow-hidden ${
                                              isChosen
                                                ? 'bg-primary/20 text-primary font-bold'
                                                : 'hover:bg-surface-container text-on-surface'
                                            }`}
                                          >
                                            <span className="px-1.5 py-0.5 rounded bg-surface-container text-[10px] font-semibold text-primary uppercase shrink-0">
                                              Category
                                            </span>
                                            <span className="truncate font-medium min-w-0">{cat.name}</span>
                                          </button>
                                        );
                                      })}
                                      {matchedItems.map((it) => {
                                        const cat = categories.find(
                                          (c) =>
                                            c.name.toLowerCase() === (it.category || '').toLowerCase() ||
                                            c.id.toLowerCase() === (it.category || '').toLowerCase()
                                        );
                                        const catSlug = cat ? sanitizeSlug(cat.name) : 'all';
                                        const itSlug = sanitizeSlug(it.title);
                                        const url = `/menu/${catSlug}/${itSlug}`;
                                        const isChosen = promoBannerTargetUrl === url;
                                        return (
                                          <button
                                            key={`match-it-${it.id}`}
                                            type="button"
                                            onClick={() => {
                                              setPromoBannerTargetUrl(url);
                                              setBannerDestSearch('');
                                            }}
                                            className={`w-full max-w-full text-left px-3 py-2 rounded-lg text-xs flex items-center gap-2 transition-colors min-w-0 overflow-hidden ${
                                              isChosen
                                                ? 'bg-primary/20 text-primary font-bold'
                                                : 'hover:bg-surface-container text-on-surface'
                                            }`}
                                          >
                                            <span className="truncate font-medium min-w-0">
                                              {it.title}{' '}
                                              <span className="text-[11px] text-on-surface-variant font-normal">
                                                · {it.category}
                                              </span>
                                            </span>
                                          </button>
                                        );
                                      })}
                                    </>
                                  );
                                })()}
                              </div>
                            )}

                            <div className="min-w-0 w-full max-w-full overflow-hidden">
                              <select
                                value={promoBannerTargetUrl}
                                onChange={(e) => setPromoBannerTargetUrl(e.target.value)}
                                className="w-full min-w-0 max-w-full bg-surface-container-low border border-outline/40 rounded-xl px-3 py-2 text-base sm:text-xs text-on-surface focus:outline-none focus:border-primary truncate"
                              >
                                <option value="/menu">Whole Menu (/menu)</option>
                                {categories.length > 0 && (
                                  <optgroup label="Categories">
                                    {categories
                                      .filter((cat) =>
                                        !bannerDestSearch.trim() ||
                                        (cat.name || '')
                                          .toLowerCase()
                                          .includes(bannerDestSearch.toLowerCase().trim())
                                      )
                                      .map((cat) => {
                                        const catSlug = sanitizeSlug(cat.name);
                                        const url = `/menu/${catSlug}`;
                                        return (
                                          <option key={cat.id} value={url}>
                                            Category: {cat.name}
                                          </option>
                                        );
                                      })}
                                  </optgroup>
                                )}
                                {items.length > 0 && (
                                  <optgroup label="Dishes & Products">
                                    {items
                                      .filter((it) => {
                                        if (!bannerDestSearch.trim()) return true;
                                        const q = bannerDestSearch.toLowerCase().trim();
                                        return (
                                          (it.title || '').toLowerCase().includes(q) ||
                                          (it.category || '').toLowerCase().includes(q)
                                        );
                                      })
                                      .map((it) => {
                                        const cat = categories.find(
                                          (c) =>
                                            c.name.toLowerCase() === (it.category || '').toLowerCase() ||
                                            c.id.toLowerCase() === (it.category || '').toLowerCase()
                                        );
                                        const catSlug = cat ? sanitizeSlug(cat.name) : 'all';
                                        const itSlug = sanitizeSlug(it.title);
                                        const url = `/menu/${catSlug}/${itSlug}`;
                                        return (
                                          <option key={it.id} value={url}>
                                            {it.title} ({it.category})
                                          </option>
                                        );
                                      })}
                                  </optgroup>
                                )}
                              </select>
                            </div>
                          </div>

                          <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2 min-w-0 max-w-full">
                            <span className="text-[11px] text-on-surface-variant font-mono shrink-0">
                              Direct Path:
                            </span>
                            <input
                              type="text"
                              value={promoBannerTargetUrl}
                              onChange={(e) => setPromoBannerTargetUrl(e.target.value)}
                              placeholder="/menu/sandwiches/tawouk"
                              className="min-w-0 w-full max-w-full flex-1 bg-surface-container-low border border-outline/40 rounded-lg px-2.5 py-2 sm:py-1.5 text-base sm:text-xs text-on-surface font-mono focus:outline-none focus:border-primary truncate"
                            />
                          </div>

                          <div className="flex items-center justify-between gap-2 text-[11px] text-on-surface-variant bg-surface-container-lowest/70 px-3 py-2 rounded-lg border border-outline-variant/20 min-w-0 max-w-full overflow-hidden">
                            <span className="truncate min-w-0 flex-1">
                              Preview:{' '}
                              <strong className="text-primary font-mono font-medium">
                                restocorano.com{promoBannerTargetUrl || '/menu'}
                              </strong>
                            </span>
                            <Link
                              to={promoBannerTargetUrl || '/menu'}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline font-semibold shrink-0"
                            >
                              Test ↗
                            </Link>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Promotional Discount on Selected Item / Category (% or $ / L.L.) */}
                    <div className="bg-surface-container p-4 rounded-xl border border-outline-variant/30 space-y-3.5 min-w-0 max-w-full overflow-hidden">
                      <div className="flex items-center justify-between gap-3 min-w-0">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-on-surface">
                              Discount on Selected Item or Category
                            </span>
                            {promoBannerDiscountEnabled && promoBannerDiscountValue > 0 && (
                              <span className="bg-error text-on-error font-bold text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full shadow-xs">
                                {formatDiscountBadgeText(
                                  promoBannerDiscountType,
                                  promoBannerDiscountValue,
                                  storeCurrency,
                                  exchangeRate || DEFAULT_LBP_RATE
                                )}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-on-surface-variant mt-0.5">
                            Add a discount in % or $ / L.L. to the selected dish or category above. When this banner is ON & Active, the item shows a discount tag and slashed original price; turning the banner OFF restores original prices immediately.
                          </div>
                        </div>

                        {/* Toggle Switch ON / OFF */}
                        <button
                          type="button"
                          role="switch"
                          aria-checked={promoBannerDiscountEnabled}
                          onClick={() => setPromoBannerDiscountEnabled((prev) => !prev)}
                          className="inline-flex items-center gap-2 py-1 px-1.5 rounded-lg cursor-pointer select-none shrink-0"
                        >
                          <span
                            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 ${
                              promoBannerDiscountEnabled
                                ? 'bg-primary border-primary'
                                : 'bg-surface-container-lowest border-outline-variant/60'
                            }`}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full transition-transform duration-200 shadow-sm ${
                                promoBannerDiscountEnabled
                                  ? 'translate-x-5 bg-on-primary'
                                  : 'translate-x-1 bg-on-surface-variant'
                              }`}
                            />
                          </span>
                          <span
                            className={`text-xs font-bold ${
                              promoBannerDiscountEnabled ? 'text-primary' : 'text-on-surface-variant'
                            }`}
                          >
                            {promoBannerDiscountEnabled ? 'ON' : 'OFF'}
                          </span>
                        </button>
                      </div>

                      {promoBannerDiscountEnabled && (
                        <div className="pt-3 border-t border-outline-variant/20 space-y-3 min-w-0 max-w-full">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 min-w-0">
                            {/* Discount Type Selector: % vs $ / L.L. */}
                            <div className="grid grid-cols-2 bg-surface-container-low p-1 rounded-xl border border-outline-variant/40 w-full sm:w-auto">
                              <button
                                type="button"
                                onClick={() => handleSwitchPromoDiscountType('percent')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                                  promoBannerDiscountType === 'percent'
                                    ? 'bg-primary text-on-primary'
                                    : 'text-on-surface-variant hover:text-on-surface'
                                }`}
                              >
                                % Percentage
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSwitchPromoDiscountType('fixed')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                                  promoBannerDiscountType === 'fixed'
                                    ? 'bg-primary text-on-primary'
                                    : 'text-on-surface-variant hover:text-on-surface'
                                }`}
                              >
                                $ / L.L. Amount
                              </button>
                            </div>

                            {/* Currency Unit Switcher when Fixed Amount is chosen */}
                            {promoBannerDiscountType === 'fixed' && (
                              <div className="grid grid-cols-2 bg-surface-container-low p-1 rounded-xl border border-outline-variant/40 w-full sm:w-auto shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleSwitchPromoDiscountInputCurrency('USD')}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono transition-colors whitespace-nowrap ${
                                    promoBannerDiscountInputCurrency === 'USD'
                                      ? 'bg-primary text-on-primary'
                                      : 'text-on-surface-variant hover:text-on-surface'
                                  }`}
                                >
                                  $ (USD)
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSwitchPromoDiscountInputCurrency('LBP')}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono transition-colors whitespace-nowrap ${
                                    promoBannerDiscountInputCurrency === 'LBP'
                                      ? 'bg-primary text-on-primary'
                                      : 'text-on-surface-variant hover:text-on-surface'
                                  }`}
                                >
                                  L.L. (89,000)
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Zero-Glitch Discount Number Box */}
                          <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                            <div className="relative flex items-center w-full sm:w-48 min-w-0">
                              <input
                                type="text"
                                inputMode={
                                  promoBannerDiscountType === 'fixed' &&
                                  promoBannerDiscountInputCurrency === 'USD'
                                    ? 'decimal'
                                    : 'numeric'
                                }
                                value={promoBannerDiscountInput}
                                onChange={(e) => handlePromoDiscountInputChange(e.target.value)}
                                placeholder={
                                  promoBannerDiscountType === 'percent'
                                    ? 'e.g. 50'
                                    : promoBannerDiscountInputCurrency === 'LBP'
                                    ? 'e.g. 445000'
                                    : 'e.g. 5'
                                }
                                className="w-full min-w-0 bg-surface-container-low border border-outline/40 rounded-xl px-3.5 py-2 text-base sm:text-sm text-on-surface font-mono tabular-nums focus:outline-none focus:border-primary pr-14"
                              />
                              <span className="absolute right-3 text-xs font-mono font-bold text-primary pointer-events-none">
                                {promoBannerDiscountType === 'percent'
                                  ? '% OFF'
                                  : promoBannerDiscountInputCurrency === 'LBP'
                                  ? 'L.L.'
                                  : '$'}
                              </span>
                            </div>

                            <span className="text-[11px] text-on-surface-variant">
                              Applies to:{' '}
                              <strong className="text-primary">
                                {getReadableDestinationLabel(promoBannerTargetUrl)}
                              </strong>
                            </span>
                          </div>

                          {/* Live Preview of Discount Tag & Slashed Price */}
                          {promoBannerDiscountValue > 0 && (
                            <div className="bg-surface-container-lowest/80 border border-outline-variant/30 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2 text-xs min-w-0">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-[11px] text-on-surface-variant shrink-0">
                                  Live Tag:
                                </span>
                                <span className="bg-error text-on-error font-bold text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full shadow-xs shrink-0">
                                  {formatDiscountBadgeText(
                                    promoBannerDiscountType,
                                    promoBannerDiscountValue,
                                    storeCurrency,
                                    exchangeRate || DEFAULT_LBP_RATE
                                  )}
                                </span>
                              </div>
                              {(() => {
                                const rate = exchangeRate || DEFAULT_LBP_RATE;
                                const cleanTarget = (promoBannerTargetUrl || '/menu').trim();
                                const parts = cleanTarget.replace(/^\/+/, '').split('/').filter(Boolean);
                                let sampleItem: MenuItem | undefined;
                                if (parts[0] === 'menu' && parts.length >= 3) {
                                  sampleItem = items.find(
                                    (it) => sanitizeSlug(it.title) === parts[2]
                                  );
                                } else if (parts[0] === 'menu' && parts.length === 2) {
                                  const cat = categories.find(
                                    (c) => sanitizeSlug(c.name) === parts[1]
                                  );
                                  sampleItem = items.find(
                                    (it) =>
                                      cat &&
                                      (it.category || '').toLowerCase() === cat.name.toLowerCase()
                                  );
                                } else {
                                  sampleItem = items[0];
                                }
                                const origPrice = sampleItem ? sampleItem.price : '10';
                                const origFmt = formatStorePrice(origPrice, storeCurrency, rate);
                                const discUsd = computeDiscountedUsdPriceString(
                                  origPrice,
                                  promoBannerDiscountType,
                                  promoBannerDiscountValue
                                );
                                const discFmt = formatStorePrice(discUsd, storeCurrency, rate);
                                return (
                                  <div className="flex items-center gap-2 font-mono text-[11px] min-w-0">
                                    <span className="text-on-surface-variant truncate max-w-[130px]">
                                      {sampleItem ? sampleItem.title : 'Example'}:
                                    </span>
                                    <span className="line-through text-on-surface-variant/75">
                                      {origFmt}
                                    </span>
                                    <span className="text-primary font-bold">{discFmt}</span>
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex justify-end min-w-0">
                      <button
                        type="button"
                        disabled={savingBannerSettings || uploadingBannerPhoto}
                        onClick={() => handleSavePromoBannerSettings()}
                        className="w-full sm:w-auto bg-primary text-on-primary px-6 py-3 sm:py-2.5 rounded-xl text-xs font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
                      >
                        {savingBannerSettings ? 'Saving...' : 'Save Banner'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Save Banners History Library (Up to 15 Saved Banners) */}
                <div className="pt-5 border-t border-outline-variant/30 space-y-3.5 min-w-0 max-w-full overflow-hidden">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 min-w-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-on-surface">
                          Save Banners
                        </h3>
                        <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-surface-container border border-outline-variant/40 text-primary">
                          {savedPromoBanners.length} / 15
                        </span>
                      </div>
                      <p className="text-[11px] text-on-surface-variant mt-0.5">
                        Banners saved when you click Save Banner above. Toggle any banner ON to make it the selected banner (automatically turning any other banner OFF).
                      </p>
                    </div>
                  </div>

                  {savedPromoBanners.length === 0 ? (
                    <div className="bg-surface-container/60 border border-outline-variant/30 rounded-xl p-4 text-center text-xs text-on-surface-variant">
                      No saved banners yet. Upload a banner above and click Save Banner to store up to 15 reusable banners here.
                    </div>
                  ) : (
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 min-w-0 max-w-full">
                      {savedPromoBanners.map((banner, idx) => {
                        const isBannerOn = activePromoBannerId === banner.id;
                        const isCurrentlyLive = promoBannerEnabled && isBannerOn;
                        const isSelectedInEditor =
                          !hasUnsavedBannerDraft && editingBannerId === banner.id;
                        const destLabel = getReadableDestinationLabel(banner.targetUrl);
                        const hasBannerDiscount = Boolean(
                          banner.discountEnabled &&
                            typeof banner.discountValue === 'number' &&
                            banner.discountValue > 0
                        );

                        return (
                          <div
                            key={banner.id}
                            className={`rounded-xl p-3 border transition-all flex flex-col justify-between gap-3 min-w-0 max-w-full overflow-hidden ${
                              isBannerOn
                                ? 'bg-primary/10 border-primary/60 shadow-md'
                                : isSelectedInEditor
                                ? 'bg-surface-container border-primary/40'
                                : 'bg-surface-container border-outline-variant/30'
                            }`}
                          >
                            <div className="flex items-start gap-3 min-w-0">
                              <img
                                src={banner.imgUrl}
                                alt={`Saved Banner ${idx + 1}`}
                                onClick={() => handleSelectSavedBannerForEdit(banner)}
                                className="w-16 h-16 rounded-lg object-cover border border-outline-variant/40 bg-surface-container-low shrink-0 cursor-pointer"
                              />
                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex items-center justify-between gap-1.5 min-w-0">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="text-xs font-bold text-on-surface truncate">
                                      Banner #{idx + 1}
                                    </span>
                                    {isSelectedInEditor && (
                                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/30 shrink-0">
                                        In Editor
                                      </span>
                                    )}
                                  </div>
                                  <span
                                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                                      isCurrentlyLive
                                        ? 'bg-primary text-on-primary'
                                        : isBannerOn
                                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                        : 'bg-surface-container-low text-on-surface-variant border border-outline-variant/40'
                                    }`}
                                  >
                                    {isCurrentlyLive
                                      ? 'ON · LIVE'
                                      : isBannerOn
                                      ? 'ON · HIDDEN'
                                      : 'OFF'}
                                  </span>
                                </div>

                                <div className="text-[11px] text-primary font-medium truncate" title={destLabel}>
                                  {banner.clickToMenu ? destLabel : 'Tap link disabled'}
                                </div>

                                <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono text-on-surface-variant">
                                  <span className="bg-surface-container-low px-1.5 py-0.5 rounded border border-outline-variant/30">
                                    {banner.delaySeconds}s delay
                                  </span>
                                  <span className="bg-surface-container-low px-1.5 py-0.5 rounded border border-outline-variant/30">
                                    {banner.maxPerDay === 0 ? 'Every visit' : `${banner.maxPerDay}x/day`}
                                  </span>
                                  {hasBannerDiscount && (
                                    <span className="bg-error text-on-error font-sans font-bold px-1.5 py-0.5 rounded-full uppercase">
                                      {formatDiscountBadgeText(
                                        banner.discountType === 'fixed' ? 'fixed' : 'percent',
                                        banner.discountValue || 0,
                                        storeCurrency,
                                        exchangeRate || DEFAULT_LBP_RATE
                                      )}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-2 pt-2 border-t border-outline-variant/25 min-w-0">
                              {/* Solely ON / OFF Toggle Switch for this Banner */}
                              <button
                                type="button"
                                role="switch"
                                aria-checked={isBannerOn}
                                disabled={savingBannerSettings || uploadingBannerPhoto}
                                onClick={() => handleToggleSavedBanner(banner, !isBannerOn)}
                                className="inline-flex items-center gap-2 py-1 px-1.5 rounded-lg cursor-pointer select-none disabled:opacity-50 group"
                              >
                                <span
                                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 ${
                                    isBannerOn
                                      ? 'bg-primary border-primary'
                                      : 'bg-surface-container-lowest border-outline-variant/60'
                                  }`}
                                >
                                  <span
                                    className={`inline-block h-4 w-4 transform rounded-full transition-transform duration-200 shadow-sm ${
                                      isBannerOn
                                        ? 'translate-x-5 bg-on-primary'
                                        : 'translate-x-1 bg-on-surface-variant'
                                    }`}
                                  />
                                </span>
                                <span
                                  className={`text-[11px] font-bold ${
                                    isBannerOn ? 'text-primary' : 'text-on-surface-variant'
                                  }`}
                                >
                                  {isBannerOn ? 'ON' : 'OFF'}
                                </span>
                              </button>

                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleSelectSavedBannerForEdit(banner)}
                                  className={`py-1.5 px-3 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${
                                    isSelectedInEditor
                                      ? 'bg-primary/20 border-primary text-primary'
                                      : 'bg-surface-container-low hover:bg-surface-container-high text-on-surface border-outline-variant/40'
                                  }`}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  disabled={isDeleting}
                                  onClick={() =>
                                    setDeleteConfirm({
                                      type: 'saved_promo_banner',
                                      id: banner.id,
                                      label: `Saved Banner #${idx + 1} (${destLabel})`,
                                    })
                                  }
                                  className="py-1.5 px-2.5 rounded-lg text-[11px] font-bold bg-error/15 hover:bg-error/25 text-error border border-error/30 transition-colors disabled:opacity-50 cursor-pointer"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* 2. Store Currency Card (Second) */}
              <div className="bg-surface-container-low border border-outline-variant/30 rounded-2xl p-4 sm:p-6 min-w-0 max-w-full overflow-hidden">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 min-w-0">
                  <div className="min-w-0">
                    <h2 className="text-base sm:text-lg font-semibold text-on-surface">
                      Menu Currency ($ / L.L.)
                    </h2>
                    <p className="text-xs text-on-surface-variant mt-1">
                      Switch live menu prices between $ and L.L. (<span className="font-mono text-primary">89,000 L.L. = $1</span>).
                    </p>
                  </div>
                  <div className="grid grid-cols-2 sm:flex items-center gap-2 bg-surface-container p-1.5 rounded-xl border border-outline-variant/40 shrink-0">
                    <button
                      type="button"
                      disabled={savingCurrency}
                      onClick={() => handleToggleStoreCurrency('USD')}
                      className={`px-4 py-2.5 sm:py-2 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                        storeCurrency === 'USD'
                          ? 'bg-primary text-on-primary'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      $ (USD)
                    </button>
                    <button
                      type="button"
                      disabled={savingCurrency}
                      onClick={() => handleToggleStoreCurrency('LBP')}
                      className={`px-4 py-2.5 sm:py-2 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                        storeCurrency === 'LBP'
                          ? 'bg-primary text-on-primary'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      L.L. (89,000)
                    </button>
                  </div>
                </div>
              </div>

              {/* 3. Admin Access Manager Card (Third) */}
              <div className="bg-surface-container-low border border-outline-variant/30 rounded-2xl p-4 sm:p-6 min-w-0 max-w-full overflow-hidden">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 min-w-0">
                  <div className="min-w-0">
                    <h2 className="text-base sm:text-lg font-semibold text-on-surface">
                      Admin Access Manager (Authorized Gmails)
                    </h2>
                    <p className="text-xs text-on-surface-variant mt-1">
                      Any Gmail added in the box will automatically receive full Admin Dashboard access.
                    </p>
                  </div>

                  <form
                    onSubmit={handleAddAdminEmail}
                    className="flex flex-col sm:flex-row gap-2.5 shrink-0 min-w-0 w-full sm:w-auto"
                  >
                    <input
                      type="email"
                      required
                      value={newAdminEmail}
                      onChange={(e) => setNewAdminEmail(e.target.value)}
                      placeholder="newadmin@gmail.com"
                      className="bg-surface-container border border-outline/40 rounded-xl px-3.5 py-2.5 text-base sm:text-sm text-on-surface w-full sm:w-auto sm:min-w-[240px] min-w-0 max-w-full focus:outline-none focus:border-primary"
                    />
                    <button
                      type="submit"
                      className="bg-primary text-on-primary px-4 py-3 sm:py-2.5 rounded-xl text-xs font-bold hover:bg-primary/90 whitespace-nowrap shrink-0"
                    >
                      Add Admin Gmail
                    </button>
                  </form>
                </div>

                {adminStatusMsg && (
                  <div className="mt-3 text-xs text-primary font-medium">{adminStatusMsg}</div>
                )}

                <div className="mt-5 pt-5 border-t border-outline-variant/30 flex flex-wrap items-center gap-2.5 text-xs min-w-0">
                  {ROOT_ADMIN_EMAILS.map((rootEmail) => (
                    <div
                      key={rootEmail}
                      className="bg-surface-container px-3.5 py-2 rounded-xl border border-primary/50 flex items-center gap-2 min-w-0 max-w-full"
                    >
                      <span className="font-mono text-on-surface font-semibold truncate">{rootEmail}</span>
                      <span aria-hidden="true" className="text-on-surface-variant shrink-0">
                        ·
                      </span>
                      <span className="text-primary font-semibold shrink-0">Root Admin</span>
                    </div>
                  ))}

                  {dynamicAdmins
                    .filter((a) => !ROOT_ADMIN_EMAILS.includes(a.email.toLowerCase()))
                    .map((adminDoc) => (
                      <div
                        key={adminDoc.id}
                        className="bg-surface-container px-3.5 py-2 rounded-xl border border-outline-variant/40 flex items-center gap-2 min-w-0 max-w-full"
                      >
                        <span className="font-mono text-on-surface truncate">{adminDoc.email}</span>
                        <span aria-hidden="true" className="text-on-surface-variant shrink-0">
                          ·
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setDeleteConfirm({
                              type: 'admin_email',
                              id: adminDoc.email,
                              label: adminDoc.email,
                            })
                          }
                          className="text-error hover:underline font-semibold shrink-0"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* MOBILE BOTTOM APP TAB BAR (iPhone & Android Thumb-Zone Optimized) */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-surface-container-low/95 backdrop-blur-md border-t border-outline-variant/40 pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-6 items-center h-16">
          {(
            [
              { id: 'dashboard', label: 'Overview', icon: 'home' },
              { id: 'products', label: 'Products', icon: 'restaurant_menu' },
              { id: 'categories', label: 'Categories', icon: 'folder' },
              { id: 'reviews', label: 'Reviews', icon: 'star', badge: pendingReviews.length },
              { id: 'ai', label: 'Corano AI', icon: 'auto_awesome', badge: aiConversations.length },
              { id: 'settings', label: 'Settings', icon: 'settings' },
            ] as const
          ).map((tab) => {
            const isActive = activeSection === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveSection(tab.id);
                  if (tab.id === 'ai') {
                    loadAiConversations();
                  }
                }}
                className={`relative flex flex-col items-center justify-center h-full transition-colors ${
                  isActive ? 'text-primary' : 'text-on-surface-variant'
                }`}
              >
                <AdminSvgIcon name={tab.icon} filled={isActive} className="text-[20px]" />
                <span className="text-[9px] font-medium mt-1 tracking-tight">{tab.label}</span>
                {'badge' in tab && typeof tab.badge === 'number' && tab.badge > 0 && (
                  <span className="absolute top-2 right-1/4 w-2 h-2 rounded-full bg-primary" />
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* ADD NEW PRODUCT MODAL (Mobile Bottom Sheet + Desktop Centered Modal) */}
      {showAddProductModal && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-xs flex items-end sm:items-center justify-center z-50 sm:p-4"
          onClick={() => setShowAddProductModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-surface-container-low border-t sm:border border-outline-variant/40 p-5 sm:p-6 rounded-t-3xl sm:rounded-2xl w-full max-w-md max-h-[92dvh] overflow-y-auto text-on-surface pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:pb-6"
          >
            <div className="w-10 h-1.5 bg-outline-variant rounded-full mx-auto mb-4 sm:hidden" />
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg text-primary">Add New Product</h3>
              <button
                type="button"
                onClick={() => setShowAddProductModal(false)}
                className="min-w-[36px] min-h-[36px] flex items-center justify-center text-on-surface-variant hover:text-on-surface"
              >
                <AdminSvgIcon name="close" className="text-[24px]" />
              </button>
            </div>
            <form onSubmit={handleAddItem} className="space-y-4">
              <div>
                <label className="block text-xs mb-1 text-on-surface-variant">Title</label>
                <input
                  required
                  value={newItem.title || ''}
                  onChange={(e) => setNewItem({ ...newItem, title: e.target.value })}
                  className="w-full bg-surface-container border border-outline/40 rounded-xl px-3.5 py-2.5 text-base sm:text-sm text-on-surface focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-xs mb-1 text-on-surface-variant">Category</label>
                <select
                  required
                  value={newItem.category || ''}
                  onChange={(e) => setNewItem({ ...newItem, category: e.target.value })}
                  className="w-full bg-surface-container border border-outline/40 rounded-xl px-3.5 py-2.5 text-base sm:text-sm text-on-surface focus:outline-none focus:border-primary"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.name.toLowerCase()}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Price Input with $ USD or L.L. Toggle */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-on-surface-variant">
                    Price ({newItemInputCurrency === 'USD' ? 'in $ USD' : 'in L.L.'})
                  </label>
                  <div className="flex items-center gap-1 bg-surface-container p-0.5 rounded-lg border border-outline-variant/40 text-[11px] font-mono">
                    <button
                      type="button"
                      onClick={() => handleSwitchNewItemInputCurrency('USD')}
                      className={`px-2.5 py-1 rounded ${
                        newItemInputCurrency === 'USD'
                          ? 'bg-primary text-on-primary font-bold'
                          : 'text-on-surface-variant'
                      }`}
                    >
                      $ USD
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSwitchNewItemInputCurrency('LBP')}
                      className={`px-2.5 py-1 rounded ${
                        newItemInputCurrency === 'LBP'
                          ? 'bg-primary text-on-primary font-bold'
                          : 'text-on-surface-variant'
                      }`}
                    >
                      L.L.
                    </button>
                  </div>
                </div>
                <input
                  required
                  value={newItemRawPriceInput}
                  onChange={(e) => setNewItemRawPriceInput(e.target.value)}
                  placeholder={newItemInputCurrency === 'USD' ? 'e.g. 6.00' : 'e.g. 534000'}
                  className="w-full bg-surface-container border border-outline/40 rounded-xl px-3.5 py-2.5 text-base sm:text-sm text-on-surface font-mono tabular-nums focus:outline-none focus:border-primary"
                />
                {newItemRawPriceInput.trim() && (
                  <div className="mt-1 text-[11px] text-primary font-mono tabular-nums">
                    {newItemInputCurrency === 'LBP'
                      ? `≈ $${convertLbpInputToUsdString(newItemRawPriceInput, exchangeRate)} USD (at 89,000 L.L./$1)`
                      : `≈ ${formatStorePrice(newItemRawPriceInput, 'LBP', exchangeRate)} (at 89,000 L.L./$1)`}
                  </div>
                )}
              </div>

              {/* Product Discount System (% or $ / L.L.) */}
              <div className="bg-surface-container border border-outline/40 rounded-xl p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-on-surface">
                    Product Discount
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={newItemDiscountEnabled}
                    onClick={() => setNewItemDiscountEnabled((prev) => !prev)}
                    className="flex items-center gap-2 shrink-0"
                  >
                    <span
                      className={`w-10 h-5 rounded-full p-0.5 flex items-center transition-colors ${
                        newItemDiscountEnabled
                          ? 'bg-primary justify-end'
                          : 'bg-surface-container-high justify-start'
                      }`}
                    >
                      <span
                        className={`w-4 h-4 rounded-full ${
                          newItemDiscountEnabled ? 'bg-on-primary' : 'bg-on-surface-variant/60'
                        }`}
                      />
                    </span>
                    <span
                      className={`text-xs font-bold ${
                        newItemDiscountEnabled ? 'text-primary' : 'text-on-surface-variant'
                      }`}
                    >
                      {newItemDiscountEnabled ? 'ON' : 'OFF'}
                    </span>
                  </button>
                </div>

                {newItemDiscountEnabled && (
                  <div className="pt-3 border-t border-outline-variant/25 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      {/* Discount Type: % vs $ / L.L. */}
                      <div className="grid grid-cols-2 bg-surface-container-low p-1 rounded-xl border border-outline-variant/40 w-full sm:w-auto">
                        <button
                          type="button"
                          onClick={() => handleSwitchNewItemDiscountType('percent')}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                            newItemDiscountType === 'percent'
                              ? 'bg-primary text-on-primary'
                              : 'text-on-surface-variant hover:text-on-surface'
                          }`}
                        >
                          % Percentage
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSwitchNewItemDiscountType('fixed')}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                            newItemDiscountType === 'fixed'
                              ? 'bg-primary text-on-primary'
                              : 'text-on-surface-variant hover:text-on-surface'
                          }`}
                        >
                          $ / L.L. Amount
                        </button>
                      </div>

                      {/* Currency Switcher when Fixed Amount is chosen */}
                      {newItemDiscountType === 'fixed' && (
                        <div className="grid grid-cols-2 bg-surface-container-low p-1 rounded-xl border border-outline-variant/40 w-full sm:w-auto shrink-0">
                          <button
                            type="button"
                            onClick={() => handleSwitchNewItemDiscountInputCurrency('USD')}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-bold font-mono transition-colors whitespace-nowrap ${
                              newItemDiscountInputCurrency === 'USD'
                                ? 'bg-primary text-on-primary'
                                : 'text-on-surface-variant hover:text-on-surface'
                            }`}
                          >
                            $ (USD)
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSwitchNewItemDiscountInputCurrency('LBP')}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-bold font-mono transition-colors whitespace-nowrap ${
                              newItemDiscountInputCurrency === 'LBP'
                                ? 'bg-primary text-on-primary'
                                : 'text-on-surface-variant hover:text-on-surface'
                            }`}
                          >
                            L.L. (89,000)
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Zero-Glitch Discount Number Box */}
                    <div className="relative flex items-center w-full">
                      <input
                        type="text"
                        inputMode={
                          newItemDiscountType === 'fixed' && newItemDiscountInputCurrency === 'USD'
                            ? 'decimal'
                            : 'numeric'
                        }
                        value={newItemDiscountInput}
                        onChange={(e) => handleNewItemDiscountInputChange(e.target.value)}
                        placeholder={
                          newItemDiscountType === 'percent'
                            ? 'e.g. 50'
                            : newItemDiscountInputCurrency === 'LBP'
                            ? 'e.g. 445000'
                            : 'e.g. 5'
                        }
                        className="w-full bg-surface-container-low border border-outline/40 rounded-xl px-3.5 py-2.5 text-base sm:text-sm text-on-surface font-mono tabular-nums focus:outline-none focus:border-primary pr-20"
                      />
                      {newItemDiscountInput !== '' && (
                        <button
                          type="button"
                          onClick={() => handleNewItemDiscountInputChange('')}
                          title="Clear discount number"
                          className="absolute right-12 w-6 h-6 rounded-full flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
                        >
                          <AdminSvgIcon name="close" className="text-[14px]" />
                        </button>
                      )}
                      <span className="absolute right-3.5 text-xs font-mono font-bold text-primary pointer-events-none">
                        {newItemDiscountType === 'percent'
                          ? '% OFF'
                          : newItemDiscountInputCurrency === 'LBP'
                          ? 'L.L.'
                          : '$'}
                      </span>
                    </div>

                    {/* Live Preview of Slashed Original Price + New Discounted Price */}
                    {newItemDiscountValue > 0 && (
                      <div className="bg-surface-container-lowest/80 border border-outline-variant/30 rounded-xl p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-on-surface-variant">Badge:</span>
                          <span className="bg-error text-on-error font-bold text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full">
                            {formatDiscountBadgeText(
                              newItemDiscountType,
                              newItemDiscountValue,
                              storeCurrency,
                              exchangeRate || DEFAULT_LBP_RATE
                            )}
                          </span>
                        </div>
                        {(() => {
                          const rate = exchangeRate || DEFAULT_LBP_RATE;
                          const rawBaseUsd =
                            newItemInputCurrency === 'LBP'
                              ? convertLbpInputToUsdString(newItemRawPriceInput || '0', rate)
                              : (newItemRawPriceInput || '0').replace(/^\$/, '').trim();
                          const basePriceForPreview =
                            parseFloat(rawBaseUsd) > 0 ? rawBaseUsd : '10';
                          const origFmt = formatStorePrice(
                            basePriceForPreview,
                            storeCurrency,
                            rate
                          );
                          const discUsd = computeDiscountedUsdPriceString(
                            basePriceForPreview,
                            newItemDiscountType,
                            newItemDiscountValue
                          );
                          const discFmt = formatStorePrice(discUsd, storeCurrency, rate);
                          return (
                            <div className="flex items-center gap-2 font-mono text-[11px]">
                              <span className="text-on-surface-variant">Menu Price:</span>
                              <span className="line-through text-on-surface-variant/75">
                                {origFmt}
                              </span>
                              <span className="text-primary font-bold">{discFmt}</span>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs mb-1 text-on-surface-variant">Description</label>
                <textarea
                  value={newItem.desc || ''}
                  onChange={(e) => setNewItem({ ...newItem, desc: e.target.value })}
                  className="w-full bg-surface-container border border-outline/40 rounded-xl px-3.5 py-2.5 text-base sm:text-sm text-on-surface focus:outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-xs mb-1 text-on-surface-variant">
                  Image URL
                </label>
                <div className="flex gap-2">
                  <input
                    value={newItem.img || ''}
                    onChange={(e) => setNewItem({ ...newItem, img: e.target.value })}
                    placeholder="https://images.restocorano.com/items/..."
                    className="flex-1 min-w-0 bg-surface-container border border-outline/40 rounded-xl px-3 py-2.5 text-base sm:text-xs text-on-surface focus:outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    disabled={uploadingAddPhoto}
                    onClick={() => addFileInputRef.current?.click()}
                    className="bg-surface-container-high hover:bg-surface-container-highest text-primary border border-primary/50 px-3.5 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 disabled:opacity-50"
                  >
                    {uploadingAddPhoto ? 'Shrinking...' : 'Upload Photo'}
                  </button>
                  <input
                    ref={addFileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAddFormPhotoSelect}
                    className="hidden"
                  />
                </div>
                {addPhotoBadge && (
                  <div className="mt-1.5 text-xs font-mono text-primary tabular-nums">
                    {addPhotoBadge}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 items-end">
                <div>
                  <label className="block text-xs mb-1 text-on-surface-variant">Order Index</label>
                  <input
                    type="number"
                    required
                    value={newItem.order ?? 99}
                    onChange={(e) =>
                      setNewItem({ ...newItem, order: parseInt(e.target.value) || 0 })
                    }
                    className="w-full bg-surface-container border border-outline/40 rounded-xl px-3.5 py-2.5 text-base sm:text-sm text-on-surface font-mono tabular-nums focus:outline-none focus:border-primary"
                  />
                </div>
                <div className="flex items-center justify-between bg-surface-container border border-outline/40 rounded-xl px-3.5 py-2.5 h-[44px] sm:h-[42px]">
                  <span className="text-xs text-on-surface-variant">In Stock</span>
                  <button
                    type="button"
                    onClick={() =>
                      setNewItem((prev) => ({
                        ...prev,
                        available: prev.available === false ? true : false,
                      }))
                    }
                    className={`w-10 h-5 rounded-full p-0.5 flex items-center ${
                      newItem.available !== false
                        ? 'bg-primary justify-end'
                        : 'bg-surface-container-high justify-start'
                    }`}
                  >
                    <span
                      className={`w-4 h-4 rounded-full ${
                        newItem.available !== false ? 'bg-on-primary' : 'bg-on-surface-variant/60'
                      }`}
                    />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between bg-surface-container border border-outline/40 rounded-xl px-3.5 py-2.5 h-[44px] sm:h-[42px]">
                <span className="text-xs text-on-surface-variant">Mark as Popular (★)</span>
                <button
                  type="button"
                  onClick={() =>
                    setNewItem((prev) => ({
                      ...prev,
                      popular: !prev.popular,
                    }))
                  }
                  className={`w-10 h-5 rounded-full p-0.5 flex items-center ${
                    newItem.popular
                      ? 'bg-primary justify-end'
                      : 'bg-surface-container-high justify-start'
                  }`}
                >
                  <span
                    className={`w-4 h-4 rounded-full ${
                      newItem.popular ? 'bg-on-primary' : 'bg-on-surface-variant/60'
                    }`}
                  />
                </button>
              </div>

              <div className="flex gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddProductModal(false)}
                  className="flex-1 bg-surface-container text-on-surface py-3 sm:py-2.5 rounded-xl text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploadingAddPhoto}
                  className="flex-1 bg-primary text-on-primary py-3 sm:py-2.5 rounded-xl text-sm font-bold disabled:opacity-50"
                >
                  Add Product
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADD CATEGORY MODAL (Mobile Bottom Sheet + Desktop Centered Modal) */}
      {showAddCategoryModal && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-xs flex items-end sm:items-center justify-center z-50 sm:p-4"
          onClick={() => setShowAddCategoryModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-surface-container-low border-t sm:border border-outline-variant/40 p-5 sm:p-6 rounded-t-3xl sm:rounded-2xl w-full max-w-sm text-on-surface pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:pb-6"
          >
            <div className="w-10 h-1.5 bg-outline-variant rounded-full mx-auto mb-4 sm:hidden" />
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg text-primary">Add Category</h3>
              <button
                type="button"
                onClick={() => setShowAddCategoryModal(false)}
                className="min-w-[36px] min-h-[36px] flex items-center justify-center text-on-surface-variant hover:text-on-surface"
              >
                <AdminSvgIcon name="close" className="text-[24px]" />
              </button>
            </div>
            <form onSubmit={handleAddCategory} className="space-y-4">
              <div>
                <label className="block text-xs mb-1 text-on-surface-variant">Category Name</label>
                <input
                  required
                  value={newCat.name || ''}
                  onChange={(e) => setNewCat({ ...newCat, name: e.target.value })}
                  className="w-full bg-surface-container border border-outline/40 rounded-xl px-3.5 py-2.5 text-base sm:text-sm text-on-surface focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-xs mb-1 text-on-surface-variant">
                  Order Number (e.g. 6, 5.5 or 5,5)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  required
                  value={newCatOrderInput}
                  onChange={(e) => setNewCatOrderInput(e.target.value)}
                  placeholder="e.g. 6 or 5.5 or 5,5"
                  className="w-full bg-surface-container border border-outline/40 rounded-xl px-3.5 py-2.5 text-base sm:text-sm text-on-surface font-mono tabular-nums focus:outline-none focus:border-primary"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddCategoryModal(false)}
                  className="flex-1 bg-surface-container text-on-surface py-3 sm:py-2.5 rounded-xl text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-primary text-on-primary py-3 sm:py-2.5 rounded-xl text-sm font-bold"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT CATEGORY MODAL (Mobile Bottom Sheet + Desktop Centered Modal) */}
      {editingCategory && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-xs flex items-end sm:items-center justify-center z-50 sm:p-4"
          onClick={() => setEditingCategory(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-surface-container-low border-t sm:border border-outline-variant/40 p-5 sm:p-6 rounded-t-3xl sm:rounded-2xl w-full max-w-sm text-on-surface pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:pb-6"
          >
            <div className="w-10 h-1.5 bg-outline-variant rounded-full mx-auto mb-4 sm:hidden" />
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg text-primary">Edit Category</h3>
              <button
                type="button"
                onClick={() => setEditingCategory(null)}
                className="min-w-[36px] min-h-[36px] flex items-center justify-center text-on-surface-variant hover:text-on-surface"
              >
                <AdminSvgIcon name="close" className="text-[24px]" />
              </button>
            </div>
            <form onSubmit={handleUpdateCategory} className="space-y-4">
              <div>
                <label className="block text-xs mb-1 text-on-surface-variant">Category Name</label>
                <input
                  required
                  value={editingCategory.name}
                  onChange={(e) =>
                    setEditingCategory({ ...editingCategory, name: e.target.value })
                  }
                  className="w-full bg-surface-container border border-outline/40 rounded-xl px-3.5 py-2.5 text-base sm:text-sm text-on-surface focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-xs mb-1 text-on-surface-variant">
                  Order Number (e.g. 6, 5.5 or 5,5)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  required
                  value={editCatOrderInput}
                  onChange={(e) => setEditCatOrderInput(e.target.value)}
                  placeholder="e.g. 6 or 5.5 or 5,5"
                  className="w-full bg-surface-container border border-outline/40 rounded-xl px-3.5 py-2.5 text-base sm:text-sm text-on-surface font-mono tabular-nums focus:outline-none focus:border-primary"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingCategory(null)}
                  className="flex-1 bg-surface-container text-on-surface py-3 sm:py-2.5 rounded-xl text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-primary text-on-primary py-3 sm:py-2.5 rounded-xl text-sm font-bold"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT PRODUCT MODAL (Mobile Bottom Sheet + Desktop Centered Modal) */}
      {editingItem && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-xs flex items-end sm:items-center justify-center z-50 sm:p-4"
          onClick={() => {
            setEditPhotoBadge(null);
            setEditingItem(null);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-surface-container-low border-t sm:border border-outline-variant/40 p-5 sm:p-6 rounded-t-3xl sm:rounded-2xl w-full max-w-md max-h-[92dvh] overflow-y-auto text-on-surface pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:pb-6"
          >
            <div className="w-10 h-1.5 bg-outline-variant rounded-full mx-auto mb-4 sm:hidden" />
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg text-primary">Edit Product</h3>
              <button
                type="button"
                onClick={() => {
                  setEditPhotoBadge(null);
                  setEditingItem(null);
                }}
                className="min-w-[36px] min-h-[36px] flex items-center justify-center text-on-surface-variant hover:text-on-surface"
              >
                <AdminSvgIcon name="close" className="text-[24px]" />
              </button>
            </div>
            <form onSubmit={handleUpdateItem} className="space-y-4">
              <div>
                <label className="block text-xs mb-1 text-on-surface-variant">Title</label>
                <input
                  required
                  value={editingItem.title}
                  onChange={(e) => setEditingItem({ ...editingItem, title: e.target.value })}
                  className="w-full bg-surface-container border border-outline/40 rounded-xl px-3.5 py-2.5 text-base sm:text-sm text-on-surface focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-xs mb-1 text-on-surface-variant">Category</label>
                <select
                  required
                  value={editingItem.category.toLowerCase()}
                  onChange={(e) => setEditingItem({ ...editingItem, category: e.target.value })}
                  className="w-full bg-surface-container border border-outline/40 rounded-xl px-3.5 py-2.5 text-base sm:text-sm text-on-surface focus:outline-none focus:border-primary"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.name.toLowerCase()}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Price Input with $ USD or L.L. Toggle */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-on-surface-variant">
                    Price ({editItemInputCurrency === 'USD' ? 'in $ USD' : 'in L.L.'})
                  </label>
                  <div className="flex items-center gap-1 bg-surface-container p-0.5 rounded-lg border border-outline-variant/40 text-[11px] font-mono">
                    <button
                      type="button"
                      onClick={() => handleSwitchEditItemInputCurrency('USD')}
                      className={`px-2.5 py-1 rounded ${
                        editItemInputCurrency === 'USD'
                          ? 'bg-primary text-on-primary font-bold'
                          : 'text-on-surface-variant'
                      }`}
                    >
                      $ USD
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSwitchEditItemInputCurrency('LBP')}
                      className={`px-2.5 py-1 rounded ${
                        editItemInputCurrency === 'LBP'
                          ? 'bg-primary text-on-primary font-bold'
                          : 'text-on-surface-variant'
                      }`}
                    >
                      L.L.
                    </button>
                  </div>
                </div>
                <input
                  required
                  value={editItemRawPriceInput}
                  onChange={(e) => setEditItemRawPriceInput(e.target.value)}
                  className="w-full bg-surface-container border border-outline/40 rounded-xl px-3.5 py-2.5 text-base sm:text-sm text-on-surface font-mono tabular-nums focus:outline-none focus:border-primary"
                />
                {editItemRawPriceInput.trim() && (
                  <div className="mt-1 text-[11px] text-primary font-mono tabular-nums">
                    {editItemInputCurrency === 'LBP'
                      ? `≈ $${convertLbpInputToUsdString(editItemRawPriceInput, exchangeRate)} USD (at 89,000 L.L./$1)`
                      : `≈ ${formatStorePrice(editItemRawPriceInput, 'LBP', exchangeRate)} (at 89,000 L.L./$1)`}
                  </div>
                )}
              </div>

              {/* Product Discount System (% or $ / L.L.) */}
              <div className="bg-surface-container border border-outline/40 rounded-xl p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-on-surface">
                    Product Discount
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={editItemDiscountEnabled}
                    onClick={() => setEditItemDiscountEnabled((prev) => !prev)}
                    className="flex items-center gap-2 shrink-0"
                  >
                    <span
                      className={`w-10 h-5 rounded-full p-0.5 flex items-center transition-colors ${
                        editItemDiscountEnabled
                          ? 'bg-primary justify-end'
                          : 'bg-surface-container-high justify-start'
                      }`}
                    >
                      <span
                        className={`w-4 h-4 rounded-full ${
                          editItemDiscountEnabled ? 'bg-on-primary' : 'bg-on-surface-variant/60'
                        }`}
                      />
                    </span>
                    <span
                      className={`text-xs font-bold ${
                        editItemDiscountEnabled ? 'text-primary' : 'text-on-surface-variant'
                      }`}
                    >
                      {editItemDiscountEnabled ? 'ON' : 'OFF'}
                    </span>
                  </button>
                </div>

                {editItemDiscountEnabled && (
                  <div className="pt-3 border-t border-outline-variant/25 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      {/* Discount Type: % vs $ / L.L. */}
                      <div className="grid grid-cols-2 bg-surface-container-low p-1 rounded-xl border border-outline-variant/40 w-full sm:w-auto">
                        <button
                          type="button"
                          onClick={() => handleSwitchEditItemDiscountType('percent')}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                            editItemDiscountType === 'percent'
                              ? 'bg-primary text-on-primary'
                              : 'text-on-surface-variant hover:text-on-surface'
                          }`}
                        >
                          % Percentage
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSwitchEditItemDiscountType('fixed')}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                            editItemDiscountType === 'fixed'
                              ? 'bg-primary text-on-primary'
                              : 'text-on-surface-variant hover:text-on-surface'
                          }`}
                        >
                          $ / L.L. Amount
                        </button>
                      </div>

                      {/* Currency Switcher when Fixed Amount is chosen */}
                      {editItemDiscountType === 'fixed' && (
                        <div className="grid grid-cols-2 bg-surface-container-low p-1 rounded-xl border border-outline-variant/40 w-full sm:w-auto shrink-0">
                          <button
                            type="button"
                            onClick={() => handleSwitchEditItemDiscountInputCurrency('USD')}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-bold font-mono transition-colors whitespace-nowrap ${
                              editItemDiscountInputCurrency === 'USD'
                                ? 'bg-primary text-on-primary'
                                : 'text-on-surface-variant hover:text-on-surface'
                            }`}
                          >
                            $ (USD)
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSwitchEditItemDiscountInputCurrency('LBP')}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-bold font-mono transition-colors whitespace-nowrap ${
                              editItemDiscountInputCurrency === 'LBP'
                                ? 'bg-primary text-on-primary'
                                : 'text-on-surface-variant hover:text-on-surface'
                            }`}
                          >
                            L.L. (89,000)
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Zero-Glitch Discount Number Box */}
                    <div className="relative flex items-center w-full">
                      <input
                        type="text"
                        inputMode={
                          editItemDiscountType === 'fixed' &&
                          editItemDiscountInputCurrency === 'USD'
                            ? 'decimal'
                            : 'numeric'
                        }
                        value={editItemDiscountInput}
                        onChange={(e) => handleEditItemDiscountInputChange(e.target.value)}
                        placeholder={
                          editItemDiscountType === 'percent'
                            ? 'e.g. 50'
                            : editItemDiscountInputCurrency === 'LBP'
                            ? 'e.g. 445000'
                            : 'e.g. 5'
                        }
                        className="w-full bg-surface-container-low border border-outline/40 rounded-xl px-3.5 py-2.5 text-base sm:text-sm text-on-surface font-mono tabular-nums focus:outline-none focus:border-primary pr-20"
                      />
                      {editItemDiscountInput !== '' && (
                        <button
                          type="button"
                          onClick={() => handleEditItemDiscountInputChange('')}
                          title="Clear discount number"
                          className="absolute right-12 w-6 h-6 rounded-full flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
                        >
                          <AdminSvgIcon name="close" className="text-[14px]" />
                        </button>
                      )}
                      <span className="absolute right-3.5 text-xs font-mono font-bold text-primary pointer-events-none">
                        {editItemDiscountType === 'percent'
                          ? '% OFF'
                          : editItemDiscountInputCurrency === 'LBP'
                          ? 'L.L.'
                          : '$'}
                      </span>
                    </div>

                    {/* Live Preview of Slashed Original Price + New Discounted Price */}
                    {editItemDiscountValue > 0 && (
                      <div className="bg-surface-container-lowest/80 border border-outline-variant/30 rounded-xl p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-on-surface-variant">Badge:</span>
                          <span className="bg-error text-on-error font-bold text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full">
                            {formatDiscountBadgeText(
                              editItemDiscountType,
                              editItemDiscountValue,
                              storeCurrency,
                              exchangeRate || DEFAULT_LBP_RATE
                            )}
                          </span>
                        </div>
                        {(() => {
                          const rate = exchangeRate || DEFAULT_LBP_RATE;
                          const rawBaseUsd =
                            editItemInputCurrency === 'LBP'
                              ? convertLbpInputToUsdString(editItemRawPriceInput || '0', rate)
                              : (editItemRawPriceInput || editingItem.price || '0')
                                  .replace(/^\$/, '')
                                  .trim();
                          const basePriceForPreview =
                            parseFloat(rawBaseUsd) > 0 ? rawBaseUsd : editingItem.price || '10';
                          const origFmt = formatStorePrice(
                            basePriceForPreview,
                            storeCurrency,
                            rate
                          );
                          const discUsd = computeDiscountedUsdPriceString(
                            basePriceForPreview,
                            editItemDiscountType,
                            editItemDiscountValue
                          );
                          const discFmt = formatStorePrice(discUsd, storeCurrency, rate);
                          return (
                            <div className="flex items-center gap-2 font-mono text-[11px]">
                              <span className="text-on-surface-variant">Menu Price:</span>
                              <span className="line-through text-on-surface-variant/75">
                                {origFmt}
                              </span>
                              <span className="text-primary font-bold">{discFmt}</span>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs mb-1 text-on-surface-variant">Description</label>
                <textarea
                  value={editingItem.desc}
                  onChange={(e) => setEditingItem({ ...editingItem, desc: e.target.value })}
                  className="w-full bg-surface-container border border-outline/40 rounded-xl px-3.5 py-2.5 text-base sm:text-sm text-on-surface focus:outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-xs mb-1 text-on-surface-variant">Image URL</label>
                <div className="flex gap-2">
                  <input
                    value={editingItem.img}
                    onChange={(e) => setEditingItem({ ...editingItem, img: e.target.value })}
                    className="flex-1 min-w-0 bg-surface-container border border-outline/40 rounded-xl px-3 py-2.5 text-base sm:text-xs text-on-surface focus:outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    disabled={uploadingEditPhoto}
                    onClick={() => editFileInputRef.current?.click()}
                    className="bg-surface-container-high hover:bg-surface-container-highest text-primary border border-primary/50 px-3.5 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 disabled:opacity-50"
                  >
                    {uploadingEditPhoto ? 'Shrinking...' : 'Upload Photo'}
                  </button>
                  <input
                    ref={editFileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleEditFormPhotoSelect}
                    className="hidden"
                  />
                </div>
                {editPhotoBadge && (
                  <div className="mt-1.5 text-xs font-mono text-primary tabular-nums">
                    {editPhotoBadge}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 items-end">
                <div>
                  <label className="block text-xs mb-1 text-on-surface-variant">Order Index</label>
                  <input
                    type="number"
                    required
                    value={editingItem.order ?? 99}
                    onChange={(e) =>
                      setEditingItem({ ...editingItem, order: parseInt(e.target.value) || 0 })
                    }
                    className="w-full bg-surface-container border border-outline/40 rounded-xl px-3.5 py-2.5 text-base sm:text-sm text-on-surface font-mono tabular-nums focus:outline-none focus:border-primary"
                  />
                </div>
                <div className="flex items-center justify-between bg-surface-container border border-outline/40 rounded-xl px-3.5 py-2.5 h-[44px] sm:h-[42px]">
                  <span className="text-xs text-on-surface-variant">In Stock</span>
                  <button
                    type="button"
                    onClick={() =>
                      setEditingItem({
                        ...editingItem,
                        available: editingItem.available === false ? true : false,
                      })
                    }
                    className={`w-10 h-5 rounded-full p-0.5 flex items-center ${
                      editingItem.available !== false
                        ? 'bg-primary justify-end'
                        : 'bg-surface-container-high justify-start'
                    }`}
                  >
                    <span
                      className={`w-4 h-4 rounded-full ${
                        editingItem.available !== false
                          ? 'bg-on-primary'
                          : 'bg-on-surface-variant/60'
                      }`}
                    />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between bg-surface-container border border-outline/40 rounded-xl px-3.5 py-2.5 h-[44px] sm:h-[42px]">
                <span className="text-xs text-on-surface-variant">Mark as Popular (★)</span>
                <button
                  type="button"
                  onClick={() =>
                    setEditingItem({
                      ...editingItem,
                      popular: !editingItem.popular,
                    })
                  }
                  className={`w-10 h-5 rounded-full p-0.5 flex items-center ${
                    editingItem.popular
                      ? 'bg-primary justify-end'
                      : 'bg-surface-container-high justify-start'
                  }`}
                >
                  <span
                    className={`w-4 h-4 rounded-full ${
                      editingItem.popular
                        ? 'bg-on-primary'
                        : 'bg-on-surface-variant/60'
                    }`}
                  />
                </button>
              </div>

              <div className="flex gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setEditPhotoBadge(null);
                    setEditingItem(null);
                  }}
                  className="flex-1 bg-surface-container text-on-surface py-3 sm:py-2.5 rounded-xl text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploadingEditPhoto}
                  className="flex-1 bg-primary text-on-primary py-3 sm:py-2.5 rounded-xl text-sm font-bold disabled:opacity-50"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL (Mobile Bottom Sheet + Desktop Centered Modal) */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-xs flex items-end sm:items-center justify-center z-50 sm:p-4"
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-surface-container-low border-t sm:border border-outline-variant/40 p-6 rounded-t-3xl sm:rounded-2xl w-full max-w-sm text-center text-on-surface pb-[calc(1.75rem+env(safe-area-inset-bottom))] sm:pb-6"
          >
            <div className="w-10 h-1.5 bg-outline-variant rounded-full mx-auto mb-4 sm:hidden" />
            <div className="w-12 h-12 rounded-full bg-error/15 text-error flex items-center justify-center mx-auto mb-4">
              <AdminSvgIcon name="warning" className="text-[26px]" />
            </div>
            <h3 className="font-semibold text-lg mb-2">
              {deleteConfirm.type === 'admin_email'
                ? 'Are you sure you want to remove?'
                : 'Are you sure you want to delete?'}
            </h3>
            <p className="text-xs text-on-surface-variant leading-relaxed mb-6">
              {deleteConfirm.type === 'admin_email' ? (
                <>
                  You are about to remove{' '}
                  <strong className="text-on-surface">"{deleteConfirm.label}"</strong> from Admin
                  access.
                </>
              ) : (
                <>
                  You are about to permanently delete{' '}
                  <strong className="text-on-surface">"{deleteConfirm.label}"</strong>. This action
                  cannot be undone.
                </>
              )}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 bg-surface-container hover:bg-surface-container-high text-on-surface py-3 sm:py-2.5 rounded-xl text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                className="flex-1 bg-error hover:bg-error/90 text-on-error py-3 sm:py-2.5 rounded-xl text-sm font-bold disabled:opacity-50"
              >
                {isDeleting
                  ? deleteConfirm.type === 'admin_email'
                    ? 'Removing...'
                    : 'Deleting...'
                  : deleteConfirm.type === 'admin_email'
                  ? 'Yes, Remove'
                  : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Admin;
