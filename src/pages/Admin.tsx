import React, { useState, useEffect, useRef } from 'react';
import { auth, db, googleProvider } from '../firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { collection, addDoc, getDocs, getDoc, deleteDoc, doc, setDoc } from 'firebase/firestore';
import { MenuItem, MenuCategory, Review, AdminUser } from '../types';
import {
  buildCollisionProofFileName,
  compressImageToBudget,
  sanitizeFirestorePayload,
  uploadCompressedToR2,
} from '../utils/imageCompressor';

export const ROOT_ADMIN_EMAILS = ['apolokor@gmail.com', 'rony.daou83@gmail.com'];

const Admin = () => {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthorizedAdmin, setIsAuthorizedAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  // Data States
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [dynamicAdmins, setDynamicAdmins] = useState<AdminUser[]>([]);

  // Form States
  const [activeTab, setActiveTab] = useState<'items' | 'categories' | 'reviews'>('items');
  const [newItem, setNewItem] = useState<Partial<MenuItem>>({ category: 'subs' });
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [newCat, setNewCat] = useState<Partial<MenuCategory>>({ name: '', order: 0 });
  const [newReview, setNewReview] = useState<Partial<Review>>({ rating: 5 });
  const [searchTerm, setSearchTerm] = useState('');

  // Dynamic Admin Gmail Form State
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [adminStatusMsg, setAdminStatusMsg] = useState<string | null>(null);

  // Image Upload States (Add Item Form & Edit Item Modal)
  const [uploadingAddPhoto, setUploadingAddPhoto] = useState(false);
  const [addPhotoBadge, setAddPhotoBadge] = useState<string | null>(null);
  const [uploadingEditPhoto, setUploadingEditPhoto] = useState(false);
  const [editPhotoBadge, setEditPhotoBadge] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const addFileInputRef = useRef<HTMLInputElement | null>(null);
  const editFileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchAdminData = async () => {
    try {
      const [catSnap, itemSnap, revSnap, adminSnap] = await Promise.all([
        getDocs(collection(db, 'menuCategories')),
        getDocs(collection(db, 'menuItems')),
        getDocs(collection(db, 'reviews')),
        getDocs(collection(db, 'admins')),
      ]);
      setCategories(
        catSnap.docs
          .map((d) => ({ id: d.id, ...d.data() } as MenuCategory))
          .sort((a, b) => a.order - b.order)
      );
      setItems(itemSnap.docs.map((d) => ({ id: d.id, ...d.data() } as MenuItem)));
      setReviews(revSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Review)));
      setDynamicAdmins(adminSnap.docs.map((d) => ({ id: d.id, ...d.data() } as AdminUser)));
    } catch (e) {
      console.error('Error loading admin data:', e);
      setStatusNotice('Error loading data from Firestore.');
    }
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u || !u.email) {
        setIsAuthorizedAdmin(false);
        setLoading(false);
        return;
      }

      const normalizedEmail = u.email.toLowerCase();
      let authorized = ROOT_ADMIN_EMAILS.includes(normalizedEmail);

      if (!authorized) {
        try {
          const adminDoc = await getDoc(doc(db, 'admins', normalizedEmail));
          authorized = adminDoc.exists();
        } catch {
          authorized = false;
        }
      }

      setIsAuthorizedAdmin(authorized);
      setLoading(false);

      if (authorized) {
        fetchAdminData();
      }
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

      // Immediately persist the updated R2 img URL to Firestore
      if (editingItem.id) {
        const sanitized = sanitizeFirestorePayload(updatedItem);
        await setDoc(doc(db, 'menuItems', editingItem.id), sanitized, { merge: true });
        await fetchAdminData();
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

  // CRUD Operations (with strict Firestore Payload Sanitization)
  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusNotice(null);
    try {
      const payload = sanitizeFirestorePayload({
        category: (newItem.category || categories[0]?.name.toLowerCase() || 'subs').toLowerCase(),
        title: newItem.title || '',
        price: newItem.price || '',
        desc: newItem.desc || '',
        img: newItem.img || '',
        order: newItem.order ?? 99,
      });
      await addDoc(collection(db, 'menuItems'), payload);
      setNewItem({
        category: categories[0]?.name.toLowerCase() || 'subs',
        title: '',
        desc: '',
        price: '',
        img: '',
        order: 99,
      });
      setAddPhotoBadge(null);
      await fetchAdminData();
      setStatusNotice('✓ Menu item added.');
    } catch (e) {
      console.error(e);
      setStatusNotice('Error adding item.');
    }
  };

  const handleUpdateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem || !editingItem.id) return;
    setStatusNotice(null);
    try {
      const sanitized = sanitizeFirestorePayload({
        ...editingItem,
        category: editingItem.category.toLowerCase(),
      });
      await setDoc(doc(db, 'menuItems', editingItem.id), sanitized, { merge: true });
      setEditingItem(null);
      setEditPhotoBadge(null);
      await fetchAdminData();
      setStatusNotice('✓ Menu item updated.');
    } catch (e) {
      console.error(e);
      setStatusNotice('Error updating item.');
    }
  };

  const handleDeleteItem = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'menuItems', id));
      await fetchAdminData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const sanitized = sanitizeFirestorePayload({
        name: newCat.name || '',
        order: newCat.order ?? categories.length + 1,
      });
      await addDoc(collection(db, 'menuCategories'), sanitized);
      setNewCat({ name: '', order: categories.length + 1 });
      await fetchAdminData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteCat = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'menuCategories', id));
      await fetchAdminData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleAddReview = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const sanitized = sanitizeFirestorePayload({
        author: newReview.author || '',
        text: newReview.text || '',
        rating: newReview.rating || 5,
        date: new Date().toLocaleDateString(),
        status: 'approved',
      });
      await addDoc(collection(db, 'reviews'), sanitized);
      setNewReview({ author: '', text: '', rating: 5 });
      await fetchAdminData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteReview = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'reviews', id));
      await fetchAdminData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleApproveReview = async (id: string) => {
    try {
      await setDoc(doc(db, 'reviews', id), { status: 'approved' }, { merge: true });
      await fetchAdminData();
    } catch (e) {
      console.error(e);
    }
  };

  // Dynamic Admin Gmail Management (/admins/{email})
  const handleAddAdminEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminStatusMsg(null);
    const normalized = newAdminEmail.trim().toLowerCase();
    if (!normalized || !normalized.includes('@')) {
      setAdminStatusMsg('Please enter a valid Gmail address.');
      return;
    }
    try {
      const payload = sanitizeFirestorePayload({
        email: normalized,
        addedBy: user?.email || 'root-admin',
        createdAt: new Date().toISOString(),
      });
      await setDoc(doc(db, 'admins', normalized), payload);
      setNewAdminEmail('');
      await fetchAdminData();
      setAdminStatusMsg(`✓ Added ${normalized} as an authorized Admin.`);
    } catch (err: any) {
      console.error('Error adding admin email:', err);
      setAdminStatusMsg(err?.message || 'Failed to add admin email.');
    }
  };

  const handleRemoveAdminEmail = async (emailId: string) => {
    setAdminStatusMsg(null);
    try {
      await deleteDoc(doc(db, 'admins', emailId.toLowerCase()));
      await fetchAdminData();
      setAdminStatusMsg(`Removed ${emailId} from dynamic admins.`);
    } catch (err: any) {
      console.error('Error removing admin email:', err);
      setAdminStatusMsg(err?.message || 'Failed to remove admin email.');
    }
  };

  if (loading) return <div className="p-10 text-center">Loading...</div>;

  if (!user || !isAuthorizedAdmin) {
    return (
      <div className="min-h-full flex items-center justify-center p-6 bg-surface text-center">
        <div className="bg-surface-container p-8 rounded-3xl max-w-md w-full">
          <span className="material-symbols-outlined text-6xl text-primary mb-4">
            admin_panel_settings
          </span>
          <h2 className="text-2xl font-bold mb-6">Admin Access Only</h2>
          <p className="mb-8 text-on-surface-variant">
            Please sign in with an authorized admin Gmail account to access the dashboard.
          </p>
          {user && !isAuthorizedAdmin && (
            <p className="mb-4 text-xs text-error">
              Signed in as {user.email}, which does not have admin access.
            </p>
          )}
          <div className="flex flex-col gap-3">
            <button
              onClick={login}
              className="bg-primary text-on-primary font-bold px-8 py-3 rounded-full hover:bg-primary/90"
            >
              Sign In with Google
            </button>
            {user && (
              <button
                onClick={logout}
                className="text-xs text-on-surface-variant hover:text-on-surface underline"
              >
                Sign out of {user.email}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const filteredItems = items
    .filter((i) => (i.title || '').toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => {
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      return (a.order ?? 99) - (b.order ?? 99);
    });

  return (
    <div className="min-h-full bg-background p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-headline text-primary">Admin Dashboard</h1>
            {user?.email && (
              <p className="text-xs text-on-surface-variant mt-1">
                Signed in as <span className="font-mono text-on-surface">{user.email}</span>
              </p>
            )}
          </div>
          <div className="flex gap-3 items-center">
            <button
              onClick={logout}
              className="bg-surface-container-high px-4 py-2 rounded-lg text-xs font-bold hover:bg-surface-container-highest whitespace-nowrap"
            >
              Logout
            </button>
          </div>
        </div>

        {statusNotice && (
          <div className="mb-6 p-3.5 rounded-xl bg-surface-container border border-primary/40 text-sm text-on-surface flex justify-between items-center">
            <span>{statusNotice}</span>
            <button
              type="button"
              onClick={() => setStatusNotice(null)}
              className="text-xs text-on-surface-variant hover:text-on-surface"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Admin Access Manager Box (Root Admins + Add/Remove Dynamic Admin Gmails) */}
        <div className="bg-surface-container-low border border-outline-variant/30 rounded-2xl p-6 mb-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h2 className="font-headline text-xl text-primary">
                Admin Access Manager (Firebase Authorized Gmails)
              </h2>
              <p className="text-xs text-on-surface-variant mt-1">
                Permanent Root Admins and dynamically authorized Gmail accounts stored in Firestore <span className="font-mono text-on-surface">/admins/&#123;email&#125;</span>. Any Gmail added below automatically receives Admin Dashboard &amp; Firestore access.
              </p>
            </div>

            <form onSubmit={handleAddAdminEmail} className="flex flex-col sm:flex-row gap-2 shrink-0">
              <input
                type="email"
                required
                value={newAdminEmail}
                onChange={(e) => setNewAdminEmail(e.target.value)}
                placeholder="newadmin@gmail.com"
                className="bg-surface-container border border-outline/50 rounded-lg px-3 py-2 text-sm text-on-surface min-w-[240px]"
              />
              <button
                type="submit"
                className="bg-primary text-on-primary px-4 py-2 rounded-lg text-xs font-bold hover:bg-primary/90 whitespace-nowrap shrink-0"
              >
                Add Admin Gmail
              </button>
            </form>
          </div>

          {adminStatusMsg && (
            <div className="mt-3 text-xs text-primary font-medium">{adminStatusMsg}</div>
          )}

          <div className="mt-4 pt-4 border-t border-outline-variant/20 flex flex-wrap items-center gap-3 text-xs">
            {ROOT_ADMIN_EMAILS.map((rootEmail) => (
              <div
                key={rootEmail}
                className="bg-surface-container px-3 py-1.5 rounded-lg border border-primary/40 flex items-center gap-2"
              >
                <span className="font-mono text-on-surface font-semibold">{rootEmail}</span>
                <span aria-hidden="true" className="text-outline-variant">·</span>
                <span className="text-primary">Root Admin</span>
              </div>
            ))}

            {dynamicAdmins
              .filter((a) => !ROOT_ADMIN_EMAILS.includes(a.email.toLowerCase()))
              .map((adminDoc) => (
                <div
                  key={adminDoc.id}
                  className="bg-surface-container px-3 py-1.5 rounded-lg border border-outline-variant/30 flex items-center gap-2"
                >
                  <span className="font-mono text-on-surface">{adminDoc.email}</span>
                  <span aria-hidden="true" className="text-outline-variant">·</span>
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

        {/* Navigation Tabs */}
        <div className="flex gap-4 border-b border-outline-variant/30 mb-8">
          {(['items', 'categories', 'reviews'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-2 px-4 capitalize whitespace-nowrap ${
                activeTab === tab
                  ? 'border-b-2 border-primary text-primary font-bold'
                  : 'text-on-surface-variant'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* ITEMS TAB */}
        {activeTab === 'items' && (
          <div className="grid md:grid-cols-3 gap-8">
            <div className="md:col-span-1 bg-surface-container-low p-6 rounded-2xl h-fit">
              <h3 className="font-bold mb-4 text-xl">Add New Item</h3>
              <form onSubmit={handleAddItem} className="space-y-4">
                <div>
                  <label className="block text-sm mb-1 text-on-surface-variant">Title</label>
                  <input
                    required
                    value={newItem.title || ''}
                    onChange={(e) => setNewItem({ ...newItem, title: e.target.value })}
                    className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2 text-on-surface"
                  />
                </div>
                <div>
                  <label className="block text-sm mb-1 text-on-surface-variant">Category</label>
                  <select
                    required
                    value={newItem.category || ''}
                    onChange={(e) => setNewItem({ ...newItem, category: e.target.value })}
                    className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2 text-on-surface"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.name.toLowerCase()}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm mb-1 text-on-surface-variant">Price</label>
                  <input
                    required
                    value={newItem.price || ''}
                    onChange={(e) => setNewItem({ ...newItem, price: e.target.value })}
                    className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2 text-on-surface"
                  />
                </div>
                <div>
                  <label className="block text-sm mb-1 text-on-surface-variant">Description</label>
                  <textarea
                    value={newItem.desc || ''}
                    onChange={(e) => setNewItem({ ...newItem, desc: e.target.value })}
                    className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2 text-on-surface"
                  />
                </div>
                <div>
                  <label className="block text-sm mb-1 text-on-surface-variant">
                    Image URL (Cloudflare R2 or Direct Link)
                  </label>
                  <div className="flex gap-2">
                    <input
                      value={newItem.img || ''}
                      onChange={(e) => setNewItem({ ...newItem, img: e.target.value })}
                      placeholder="https://images.restocorano.com/items/..."
                      className="flex-1 min-w-0 bg-surface-container border border-outline/50 rounded px-3 py-2 text-on-surface text-sm"
                    />
                    <button
                      type="button"
                      disabled={uploadingAddPhoto}
                      onClick={() => addFileInputRef.current?.click()}
                      className="bg-surface-container-high hover:bg-surface-container-highest text-primary border border-primary/40 px-3 py-2 rounded text-xs font-bold whitespace-nowrap shrink-0 disabled:opacity-50"
                    >
                      {uploadingAddPhoto ? 'Shrinking & Uploading...' : 'Upload Photo'}
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
                <div>
                  <label className="block text-sm mb-1 text-on-surface-variant">Order Index</label>
                  <input
                    type="number"
                    required
                    value={newItem.order ?? 99}
                    onChange={(e) =>
                      setNewItem({ ...newItem, order: parseInt(e.target.value) || 0 })
                    }
                    className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2 text-on-surface font-mono tabular-nums"
                  />
                </div>
                <button
                  type="submit"
                  disabled={uploadingAddPhoto}
                  className="w-full bg-primary text-on-primary py-2 rounded font-bold hover:bg-primary/90 disabled:opacity-50"
                >
                  Add Item
                </button>
              </form>
            </div>

            <div className="md:col-span-2">
              <input
                type="text"
                placeholder="Search items..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-surface-container border border-outline/50 rounded-lg px-4 py-3 mb-6 text-on-surface focus:outline-none focus:border-primary"
              />
              <div className="grid sm:grid-cols-2 gap-4">
                {filteredItems.map((item) => (
                  <div
                    key={item.id}
                    className="bg-surface-container-low p-4 rounded-xl border border-outline-variant/30 flex justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <h4 className="font-bold flex items-center gap-2">
                        <span className="bg-surface-container text-xs px-2 py-1 rounded font-mono tabular-nums">
                          {item.order ?? 99}
                        </span>
                        <span className="truncate">{item.title}</span>
                      </h4>
                      <div className="text-sm text-primary mb-1 font-mono tabular-nums">
                        ${item.price}
                      </div>
                      <div className="text-xs text-on-surface-variant bg-surface-container inline-block px-2 py-1 rounded mb-2">
                        {item.category}
                      </div>
                      {item.img ? (
                        <div
                          className="text-xs text-on-surface-variant bg-surface-container-high rounded p-1 max-w-[200px] sm:max-w-[260px] overflow-hidden text-ellipsis whitespace-nowrap"
                          title={item.img}
                        >
                          <a
                            href={item.img}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline flex items-center gap-1"
                          >
                            <span className="material-symbols-outlined text-[14px]">link</span>
                            {item.img.includes('restocorano.com')
                              ? 'R2 Image URL'
                              : 'Image URL'}
                          </a>
                        </div>
                      ) : (
                        <div className="text-xs text-error mt-1 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px]">warning</span> No
                          Image
                        </div>
                      )}
                    </div>
                    <div className="flex items-start gap-1 shrink-0">
                      <button
                        onClick={() => {
                          setEditPhotoBadge(null);
                          setEditingItem(item);
                        }}
                        className="text-primary hover:bg-primary/10 p-2 rounded h-fit"
                      >
                        <span className="material-symbols-outlined">edit</span>
                      </button>
                      <button
                        onClick={() => handleDeleteItem(item.id!)}
                        className="text-error hover:bg-error/10 p-2 rounded h-fit"
                      >
                        <span className="material-symbols-outlined">delete</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* CATEGORIES TAB */}
        {activeTab === 'categories' && (
          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-surface-container-low p-6 rounded-2xl h-fit">
              <h3 className="font-bold mb-4 text-xl">Add Category</h3>
              <form onSubmit={handleAddCategory} className="space-y-4">
                <div>
                  <label className="block text-sm mb-1 text-on-surface-variant">Name</label>
                  <input
                    required
                    value={newCat.name || ''}
                    onChange={(e) => setNewCat({ ...newCat, name: e.target.value })}
                    className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2 text-on-surface"
                  />
                </div>
                <div>
                  <label className="block text-sm mb-1 text-on-surface-variant">Order Index</label>
                  <input
                    type="number"
                    required
                    value={newCat.order ?? categories.length + 1}
                    onChange={(e) =>
                      setNewCat({ ...newCat, order: parseInt(e.target.value) || 0 })
                    }
                    className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2 text-on-surface font-mono tabular-nums"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full bg-primary text-on-primary py-2 rounded font-bold hover:bg-primary/90"
                >
                  Add Category
                </button>
              </form>
            </div>
            <div className="space-y-4">
              {categories.map((cat) => (
                <div
                  key={cat.id}
                  className="bg-surface-container-low p-4 rounded-xl border border-outline-variant/30 flex justify-between items-center"
                >
                  <div className="flex items-center gap-4">
                    <span className="bg-surface-container w-8 h-8 flex items-center justify-center rounded font-bold font-mono tabular-nums">
                      {cat.order}
                    </span>
                    <h4 className="font-bold">{cat.name}</h4>
                  </div>
                  <button
                    onClick={() => handleDeleteCat(cat.id!)}
                    className="text-error hover:bg-error/10 p-2 rounded"
                  >
                    <span className="material-symbols-outlined">delete</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* REVIEWS TAB */}
        {activeTab === 'reviews' && (
          <div className="grid md:grid-cols-3 gap-8">
            <div className="md:col-span-1 bg-surface-container-low p-6 rounded-2xl h-fit">
              <h3 className="font-bold mb-4 text-xl">Add Manual Review</h3>
              <form onSubmit={handleAddReview} className="space-y-4">
                <div>
                  <label className="block text-sm mb-1 text-on-surface-variant">Author Name</label>
                  <input
                    required
                    value={newReview.author || ''}
                    onChange={(e) => setNewReview({ ...newReview, author: e.target.value })}
                    className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2 text-on-surface"
                  />
                </div>
                <div>
                  <label className="block text-sm mb-1 text-on-surface-variant">Rating (1-5)</label>
                  <input
                    type="number"
                    min="1"
                    max="5"
                    required
                    value={newReview.rating || 5}
                    onChange={(e) =>
                      setNewReview({ ...newReview, rating: parseInt(e.target.value) || 5 })
                    }
                    className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2 text-on-surface font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-sm mb-1 text-on-surface-variant">Review Text</label>
                  <textarea
                    required
                    value={newReview.text || ''}
                    onChange={(e) => setNewReview({ ...newReview, text: e.target.value })}
                    className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2 text-on-surface"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full bg-primary text-on-primary py-2 rounded font-bold hover:bg-primary/90"
                >
                  Add Review
                </button>
              </form>
            </div>
            <div className="md:col-span-2 space-y-4">
              {reviews.map((review) => (
                <div
                  key={review.id}
                  className={`bg-surface-container-low p-4 rounded-xl border ${
                    review.status === 'pending' ? 'border-primary' : 'border-outline-variant/30'
                  } flex justify-between`}
                >
                  <div>
                    <h4 className="font-bold flex items-center gap-2">
                      {review.author} <span className="text-primary font-normal">★ {review.rating}</span>
                      {review.status === 'pending' && (
                        <span className="text-xs text-primary font-semibold">· Pending</span>
                      )}
                    </h4>
                    <p className="text-on-surface-variant text-sm mt-1">{review.text}</p>
                    <span className="text-xs text-on-surface-variant/50">{review.date}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {review.status === 'pending' && (
                      <button
                        onClick={() => handleApproveReview(review.id!)}
                        className="text-primary hover:bg-primary/10 p-2 rounded h-fit"
                        title="Approve"
                      >
                        <span className="material-symbols-outlined">check_circle</span>
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteReview(review.id!)}
                      className="text-error hover:bg-error/10 p-2 rounded h-fit"
                      title="Delete"
                    >
                      <span className="material-symbols-outlined">delete</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* EDIT MODAL */}
      {editingItem && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-surface p-6 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h3 className="font-bold mb-4 text-xl">Edit Item</h3>
            <form onSubmit={handleUpdateItem} className="space-y-4">
              <div>
                <label className="block text-sm mb-1 text-on-surface-variant">Title</label>
                <input
                  required
                  value={editingItem.title}
                  onChange={(e) => setEditingItem({ ...editingItem, title: e.target.value })}
                  className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm mb-1 text-on-surface-variant">Category</label>
                <select
                  required
                  value={editingItem.category.toLowerCase()}
                  onChange={(e) => setEditingItem({ ...editingItem, category: e.target.value })}
                  className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.name.toLowerCase()}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1 text-on-surface-variant">Price</label>
                <input
                  required
                  value={editingItem.price}
                  onChange={(e) => setEditingItem({ ...editingItem, price: e.target.value })}
                  className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm mb-1 text-on-surface-variant">Description</label>
                <textarea
                  value={editingItem.desc}
                  onChange={(e) => setEditingItem({ ...editingItem, desc: e.target.value })}
                  className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm mb-1 text-on-surface-variant">Image URL</label>
                <div className="flex gap-2">
                  <input
                    value={editingItem.img}
                    onChange={(e) => setEditingItem({ ...editingItem, img: e.target.value })}
                    className="flex-1 min-w-0 bg-surface-container border border-outline/50 rounded px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    disabled={uploadingEditPhoto}
                    onClick={() => editFileInputRef.current?.click()}
                    className="bg-surface-container-high hover:bg-surface-container-highest text-primary border border-primary/40 px-3 py-2 rounded text-xs font-bold whitespace-nowrap shrink-0 disabled:opacity-50"
                  >
                    {uploadingEditPhoto ? 'Shrinking & Uploading...' : 'Upload Photo'}
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
              <div>
                <label className="block text-sm mb-1 text-on-surface-variant">Order Index</label>
                <input
                  type="number"
                  required
                  value={editingItem.order ?? 99}
                  onChange={(e) =>
                    setEditingItem({ ...editingItem, order: parseInt(e.target.value) || 0 })
                  }
                  className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2 font-mono tabular-nums"
                />
              </div>
              <div className="flex gap-4 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setEditPhotoBadge(null);
                    setEditingItem(null);
                  }}
                  className="flex-1 bg-surface-container text-on-surface py-2 rounded font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploadingEditPhoto}
                  className="flex-1 bg-primary text-on-primary py-2 rounded font-bold disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Admin;
