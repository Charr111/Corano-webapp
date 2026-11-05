import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { auth, googleProvider } from '../firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { MenuItem, MenuCategory, Review, AdminUser, StoreDataPayload } from '../types';
import {
  buildCollisionProofFileName,
  compressImageToBudget,
  sanitizeFirestorePayload,
  uploadCompressedToR2,
} from '../utils/imageCompressor';
import {
  convertLbpInputToUsdString,
  convertUsdStringToLbpInput,
  DEFAULT_LBP_RATE,
  formatStorePrice,
  StoreCurrency,
} from '../utils/currency';
import {
  fetchLiveStoreData,
  getCachedStoreData,
  mutateR2StoreData,
} from '../utils/r2DataClient';

export const ROOT_ADMIN_EMAILS = ['apolokor@gmail.com', 'rony.daou83@gmail.com'];

type AdminSection = 'dashboard' | 'products' | 'categories' | 'reviews' | 'settings';

interface DeleteConfirmationState {
  type: 'item' | 'category' | 'review';
  id: string;
  label: string;
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

  // Global Store Currency State ($ USD vs L.L. at 89,000)
  const [storeCurrency, setStoreCurrency] = useState<StoreCurrency>('USD');
  const [exchangeRate, setExchangeRate] = useState<number>(DEFAULT_LBP_RATE);
  const [savingCurrency, setSavingCurrency] = useState(false);

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

  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [editItemInputCurrency, setEditItemInputCurrency] = useState<StoreCurrency>('USD');
  const [editItemRawPriceInput, setEditItemRawPriceInput] = useState<string>('');

  const [newCat, setNewCat] = useState<Partial<MenuCategory>>({ name: '', order: 1 });
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

  const applyStoreState = (store: StoreDataPayload) => {
    const loadedCats = [...(store.categories || [])].sort(
      (a, b) => (a.order ?? 99) - (b.order ?? 99)
    );
    setCategories(loadedCats);
    setItems(store.items || []);
    setReviews(store.reviews || []);
    setDynamicAdmins(store.admins || []);
    if (store.settings?.currency === 'LBP' || store.settings?.currency === 'USD') {
      setStoreCurrency(store.settings.currency);
    }
    if (typeof store.settings?.exchangeRate === 'number' && store.settings.exchangeRate > 0) {
      setExchangeRate(store.settings.exchangeRate);
    }
  };

  const fetchAdminData = async () => {
    try {
      const liveStore = await fetchLiveStoreData(true);
      applyStoreState(liveStore);
    } catch (e) {
      console.error('Error loading admin data from R2:', e);
      setStatusNotice('Error loading data from Cloudflare R2.');
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
    });
    return () => unsub();
  }, []);

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
      setStatusNotice(err?.message || 'Failed to shrink & upload photo to R2');
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

      const updatedItem: MenuItem = { ...editingItem, img: uploaded.url };
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
      setStatusNotice(err?.message || 'Failed to shrink & upload photo to R2');
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

      const payload = sanitizeFirestorePayload({
        category: (newItem.category || categories[0]?.name.toLowerCase() || 'subs').toLowerCase(),
        title: newItem.title || '',
        price: finalUsdPrice || '0',
        desc: newItem.desc || '',
        img: newItem.img || '',
        available: newItem.available !== false,
        popular: Boolean(newItem.popular),
        order: newItem.order ?? 99,
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

      const itemPayload = {
        ...editingItem,
        price: finalUsdPrice || editingItem.price || '0',
        category: editingItem.category.toLowerCase(),
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
      const updatedStore = await mutateR2StoreData('saveCategory', {
        category: {
          name: newCat.name || '',
          order: newCat.order ?? categories.length + 1,
        },
      });
      applyStoreState(updatedStore);
      setNewCat({ name: '', order: (updatedStore.categories?.length || categories.length) + 1 });
      setShowAddCategoryModal(false);
      setStatusNotice('✓ Category added.');
    } catch (e: any) {
      console.error(e);
      setStatusNotice(e?.message || 'Error adding category.');
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
      }
      setDeleteConfirm(null);
    } catch (err: any) {
      console.error('Error deleting record:', err);
      setStatusNotice(err?.message || 'Failed to delete record.');
    } finally {
      setIsDeleting(false);
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
          <span className="material-symbols-outlined text-6xl text-primary mb-4">
            admin_panel_settings
          </span>
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
      return (a.order ?? 99) - (b.order ?? 99);
    });

  const sectionLabelMap: Record<AdminSection, string> = {
    dashboard: 'Overview',
    products: 'Products & Menu',
    categories: 'Categories',
    reviews: 'Customer Reviews',
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
    setShowAddProductModal(true);
  };

  const openNewCategorySheet = () => {
    setNewCat({ name: '', order: categories.length + 1 });
    setShowAddCategoryModal(true);
  };

  return (
    <div className="min-h-[100dvh] bg-background text-on-surface flex flex-col lg:flex-row">
      {/* Mobile Sidebar Drawer Backdrop */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/75 backdrop-blur-xs z-50 lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* Left Sidebar (Desktop Fixed + Mobile Slide-Over Drawer) */}
      <aside
        className={`fixed lg:sticky lg:top-0 lg:h-[100dvh] inset-y-0 left-0 z-50 w-64 bg-surface-container-low border-r border-outline-variant/40 flex flex-col justify-between transition-transform duration-200 ${
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div>
          {/* Brand Logo Header */}
          <div className="px-7 pt-7 pb-6 flex items-center justify-between">
            <Link to="/home" className="inline-flex items-start group">
              <span className="font-headline text-3xl font-bold tracking-tight text-on-surface group-hover:text-primary transition-colors">
                Corano
              </span>
              <span className="w-2 h-2 rounded-full bg-primary ml-1 mt-1" />
            </Link>
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(false)}
              className="lg:hidden min-w-[44px] min-h-[44px] flex items-center justify-center text-on-surface-variant hover:text-on-surface -mr-2"
            >
              <span className="material-symbols-outlined">close</span>
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
                  }}
                  className={`w-full flex items-center justify-between px-7 py-3.5 text-sm font-medium transition-colors relative ${
                    isActive
                      ? 'bg-surface-container text-on-surface'
                      : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50'
                  }`}
                >
                  <div className="flex items-center gap-3.5">
                    <span
                      className={`material-symbols-outlined text-[20px] ${
                        isActive ? 'text-primary' : 'text-primary/80'
                      }`}
                    >
                      {navItem.icon}
                    </span>
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
            <span className="material-symbols-outlined text-[18px]">visibility</span>
            <span>View Public Menu</span>
          </Link>
          <button
            type="button"
            onClick={logout}
            className="w-full flex items-center gap-3 text-sm text-on-surface-variant hover:text-on-surface transition-colors pt-1"
          >
            <span className="material-symbols-outlined text-[20px]">logout</span>
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 pb-24 lg:pb-10">
        {/* Sticky Top App Bar (Optimized for iPhone/Android & Desktop) */}
        <header className="sticky top-0 z-30 h-16 lg:h-20 px-4 sm:px-6 lg:px-10 bg-background/95 backdrop-blur-md border-b border-outline-variant/30 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open menu"
              className="lg:hidden min-w-[40px] min-h-[40px] rounded-xl bg-surface-container-low border border-outline-variant/40 flex items-center justify-center text-on-surface active:scale-95 transition-transform"
            >
              <span className="material-symbols-outlined text-[20px]">menu</span>
            </button>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm truncate">
                <span className="font-headline font-bold text-primary lg:hidden">Corano</span>
                <span className="text-on-surface-variant hidden lg:inline">Dashboard</span>
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
              <span className="material-symbols-outlined text-[18px] text-on-surface-variant absolute left-3.5 top-1/2 -translate-y-1/2">
                search
              </span>
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
                    <span
                      className={`material-symbols-outlined text-[14px] text-on-surface-variant transition-transform ${
                        showAdminMenu ? 'rotate-180' : ''
                      }`}
                    >
                      expand_more
                    </span>
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
                      <span className="material-symbols-outlined text-[18px]">logout</span>
                      <span>Log out</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Main Scrollable Viewport */}
        <div className="flex-1 px-4 py-5 sm:px-6 lg:px-10 lg:py-8 max-w-[1400px] w-full mx-auto space-y-6 lg:space-y-8">
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

            <div className="grid grid-cols-2 sm:flex items-center gap-2.5 sm:gap-3">
              <button
                type="button"
                onClick={openNewProductSheet}
                className="bg-primary hover:bg-primary/90 active:scale-[0.98] text-on-primary font-bold px-4 py-3 sm:py-2.5 rounded-xl text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-all whitespace-nowrap shadow-md"
              >
                <span className="material-symbols-outlined text-[18px]">add</span>
                <span>Add Product</span>
              </button>
              <button
                type="button"
                onClick={openNewCategorySheet}
                className="bg-surface-container-low hover:bg-surface-container active:scale-[0.98] text-primary border border-primary/60 font-semibold px-4 py-3 sm:py-2.5 rounded-xl text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-all whitespace-nowrap"
              >
                <span className="material-symbols-outlined text-[18px]">add</span>
                <span>Add Category</span>
              </button>
            </div>
          </div>

          {/* Mobile Search Bar (Shown on Dashboard & Products views on mobile/tablet) */}
          {(activeSection === 'dashboard' || activeSection === 'products') && (
            <div className="md:hidden">
              <div className="relative">
                <span className="material-symbols-outlined text-[18px] text-on-surface-variant absolute left-3.5 top-1/2 -translate-y-1/2">
                  search
                </span>
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
                    <span className="material-symbols-outlined text-[18px]">close</span>
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
                        <span className="material-symbols-outlined text-[19px] text-primary">
                          {getCategoryIconName(cat.name)}
                        </span>
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
                    <span className="material-symbols-outlined text-[18px]">add</span>
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
                        return (
                          <div
                            key={item.id}
                            className="p-3.5 sm:px-6 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 hover:bg-surface-container/40 transition-colors"
                          >
                            {/* Top / Left: Thumbnail + Title & Category + Mobile Price */}
                            <div className="flex items-center gap-3.5 min-w-0 flex-1">
                              <div className="w-13 h-13 sm:w-12 sm:h-12 rounded-xl bg-surface-container overflow-hidden shrink-0 border border-outline-variant/30">
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
                                    <span className="material-symbols-outlined text-[20px]">
                                      restaurant
                                    </span>
                                  </div>
                                )}
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="text-sm sm:text-base font-semibold text-on-surface leading-snug line-clamp-2 sm:truncate">
                                    {item.title}
                                  </div>
                                  {/* Price shown on top-right on phone for clean thumb-zone alignment */}
                                  <div className="sm:hidden text-sm font-bold text-primary font-mono tabular-nums whitespace-nowrap shrink-0">
                                    {formatStorePrice(item.price, storeCurrency, exchangeRate)}
                                  </div>
                                </div>
                                <div className="text-xs text-on-surface-variant capitalize flex flex-wrap items-center gap-1.5 mt-0.5">
                                  <span>{item.category}</span>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-mono tabular-nums">
                                    #{item.order ?? 99}
                                  </span>
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

                            {/* Desktop Center: Formatted Price ($ or L.L.) */}
                            <div className="hidden sm:block text-base font-bold text-primary font-mono tabular-nums whitespace-nowrap">
                              {formatStorePrice(item.price, storeCurrency, exchangeRate)}
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
                                  <span
                                    className="material-symbols-outlined text-[20px]"
                                    style={{
                                      fontVariationSettings: item.popular ? "'FILL' 1" : "'FILL' 0",
                                    }}
                                  >
                                    star
                                  </span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => openEditModal(item)}
                                  title="Edit Product"
                                  className="min-w-[40px] min-h-[40px] sm:min-w-[36px] sm:min-h-[36px] flex items-center justify-center text-on-surface-variant hover:text-primary rounded-xl hover:bg-surface-container active:scale-95 transition-all"
                                >
                                  <span className="material-symbols-outlined text-[20px]">
                                    edit
                                  </span>
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
                                  <span className="material-symbols-outlined text-[20px]">
                                    delete
                                  </span>
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
                  <div className="lg:col-span-1">
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
                                <span
                                  key={star}
                                  className="material-symbols-outlined text-[15px]"
                                  style={{
                                    fontVariationSettings:
                                      star <= (rev.rating || 5) ? "'FILL' 1" : "'FILL' 0",
                                  }}
                                >
                                  star
                                </span>
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
                      Order Index
                    </label>
                    <input
                      type="number"
                      required
                      value={newCat.order ?? categories.length + 1}
                      onChange={(e) =>
                        setNewCat({ ...newCat, order: parseInt(e.target.value) || 0 })
                      }
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
                        <span className="bg-surface-container text-primary w-9 h-9 flex items-center justify-center rounded-xl text-xs font-bold font-mono tabular-nums border border-outline-variant/30">
                          {cat.order}
                        </span>
                        <div>
                          <h4 className="font-semibold text-on-surface">{cat.name}</h4>
                          <span className="text-xs text-on-surface-variant font-mono tabular-nums">
                            {count} products
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setDeleteConfirm({
                            type: 'category',
                            id: cat.id,
                            label: cat.name,
                          })
                        }
                        className="min-w-[44px] min-h-[44px] flex items-center justify-center text-on-surface-variant hover:text-error rounded-xl hover:bg-surface-container"
                      >
                        <span className="material-symbols-outlined text-[20px]">delete</span>
                      </button>
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

          {/* SETTINGS & ADMIN ACCESS MANAGER SECTION */}
          {activeSection === 'settings' && (
            <div className="space-y-6">
              {/* Store Currency Configuration Card */}
              <div className="bg-surface-container-low border border-outline-variant/30 rounded-2xl p-5 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base sm:text-lg font-semibold text-on-surface">
                      Website Menu Currency ($ USD vs. L.L.)
                    </h2>
                    <p className="text-xs text-on-surface-variant mt-1">
                      Switch the live public menu between US Dollars ($) and Lebanese Lira (L.L. converted at{' '}
                      <span className="font-mono text-primary">89,000 L.L. = $1</span>).
                    </p>
                  </div>
                  <div className="grid grid-cols-2 sm:flex items-center gap-2 bg-surface-container p-1.5 rounded-xl border border-outline-variant/40">
                    <button
                      type="button"
                      disabled={savingCurrency}
                      onClick={() => handleToggleStoreCurrency('USD')}
                      className={`px-4 py-2.5 sm:py-2 rounded-lg text-xs font-bold transition-colors ${
                        storeCurrency === 'USD'
                          ? 'bg-primary text-on-primary'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      Display in $ (USD)
                    </button>
                    <button
                      type="button"
                      disabled={savingCurrency}
                      onClick={() => handleToggleStoreCurrency('LBP')}
                      className={`px-4 py-2.5 sm:py-2 rounded-lg text-xs font-bold transition-colors ${
                        storeCurrency === 'LBP'
                          ? 'bg-primary text-on-primary'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      Display in L.L. (89,000)
                    </button>
                  </div>
                </div>
              </div>

              {/* Admin Access Manager Card */}
              <div className="bg-surface-container-low border border-outline-variant/30 rounded-2xl p-5 sm:p-6">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                  <div>
                    <h2 className="text-base sm:text-lg font-semibold text-on-surface">
                      Admin Access Manager (Authorized Gmails)
                    </h2>
                    <p className="text-xs text-on-surface-variant mt-1">
                      Any Gmail added in the box will automatically receive full Admin Dashboard access.
                    </p>
                  </div>

                  <form
                    onSubmit={handleAddAdminEmail}
                    className="flex flex-col sm:flex-row gap-2.5 shrink-0"
                  >
                    <input
                      type="email"
                      required
                      value={newAdminEmail}
                      onChange={(e) => setNewAdminEmail(e.target.value)}
                      placeholder="newadmin@gmail.com"
                      className="bg-surface-container border border-outline/40 rounded-xl px-3.5 py-2.5 text-base sm:text-sm text-on-surface min-w-[240px] focus:outline-none focus:border-primary"
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

                <div className="mt-5 pt-5 border-t border-outline-variant/30 flex flex-wrap items-center gap-2.5 text-xs">
                  {ROOT_ADMIN_EMAILS.map((rootEmail) => (
                    <div
                      key={rootEmail}
                      className="bg-surface-container px-3.5 py-2 rounded-xl border border-primary/50 flex items-center gap-2"
                    >
                      <span className="font-mono text-on-surface font-semibold">{rootEmail}</span>
                      <span aria-hidden="true" className="text-on-surface-variant">
                        ·
                      </span>
                      <span className="text-primary font-semibold">Root Admin</span>
                    </div>
                  ))}

                  {dynamicAdmins
                    .filter((a) => !ROOT_ADMIN_EMAILS.includes(a.email.toLowerCase()))
                    .map((adminDoc) => (
                      <div
                        key={adminDoc.id}
                        className="bg-surface-container px-3.5 py-2 rounded-xl border border-outline-variant/40 flex items-center gap-2"
                      >
                        <span className="font-mono text-on-surface">{adminDoc.email}</span>
                        <span aria-hidden="true" className="text-on-surface-variant">
                          ·
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveAdminEmail(adminDoc.email)}
                          className="text-error hover:underline font-semibold"
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
        <div className="grid grid-cols-5 items-center h-16">
          {(
            [
              { id: 'dashboard', label: 'Overview', icon: 'home' },
              { id: 'products', label: 'Products', icon: 'restaurant_menu' },
              { id: 'categories', label: 'Categories', icon: 'folder' },
              { id: 'reviews', label: 'Reviews', icon: 'star', badge: pendingReviews.length },
              { id: 'settings', label: 'Settings', icon: 'settings' },
            ] as const
          ).map((tab) => {
            const isActive = activeSection === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveSection(tab.id)}
                className={`relative flex flex-col items-center justify-center h-full transition-colors ${
                  isActive ? 'text-primary' : 'text-on-surface-variant'
                }`}
              >
                <span
                  className="material-symbols-outlined text-[22px]"
                  style={{ fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0" }}
                >
                  {tab.icon}
                </span>
                <span className="text-[10px] font-medium mt-1 tracking-tight">{tab.label}</span>
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
                <span className="material-symbols-outlined">close</span>
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
                  Image URL (Cloudflare R2 or Direct Link)
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
                <span className="material-symbols-outlined">close</span>
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
                <label className="block text-xs mb-1 text-on-surface-variant">Order Index</label>
                <input
                  type="number"
                  required
                  value={newCat.order ?? categories.length + 1}
                  onChange={(e) =>
                    setNewCat({ ...newCat, order: parseInt(e.target.value) || 0 })
                  }
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
                <span className="material-symbols-outlined">close</span>
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
              <span className="material-symbols-outlined text-[26px]">warning</span>
            </div>
            <h3 className="font-semibold text-lg mb-2">Are you sure you want to delete?</h3>
            <p className="text-xs text-on-surface-variant leading-relaxed mb-6">
              You are about to permanently delete{' '}
              <strong className="text-on-surface">"{deleteConfirm.label}"</strong>. This action cannot be undone.
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
                {isDeleting ? 'Deleting...' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Admin;
