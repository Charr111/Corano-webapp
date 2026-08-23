import React, { useState, useEffect } from 'react';
import { auth, db, googleProvider } from '../firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { collection, addDoc, getDocs, deleteDoc, doc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { MenuItem, MenuCategory, Review } from '../types';

const Admin = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Data States
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  
  // Form States
  const [activeTab, setActiveTab] = useState<'items' | 'categories' | 'reviews'>('items');
  const [newItem, setNewItem] = useState<Partial<MenuItem>>({ category: 'subs' });
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [newCat, setNewCat] = useState<Partial<MenuCategory>>({ name: '', order: 0 });
  const [newReview, setNewReview] = useState<Partial<Review>>({ rating: 5 });
  const [searchTerm, setSearchTerm] = useState('');

  const ADMIN_EMAIL = 'apolokor@gmail.com';

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (u?.email === ADMIN_EMAIL) {
        fetchAdminData();
      }
    });
    return () => unsub();
  }, []);

  const fetchAdminData = async () => {
    try {
      const [catSnap, itemSnap, revSnap] = await Promise.all([
        getDocs(collection(db, 'menuCategories')),
        getDocs(collection(db, 'menuItems')),
        getDocs(collection(db, 'reviews'))
      ]);
      setCategories(catSnap.docs.map(d => ({ id: d.id, ...d.data() } as MenuCategory)).sort((a,b) => a.order - b.order));
      setItems(itemSnap.docs.map(d => ({ id: d.id, ...d.data() } as MenuItem)));
      setReviews(revSnap.docs.map(d => ({ id: d.id, ...d.data() } as Review)));
    } catch (e) {
      console.error(e);
      alert("Error loading data");
    }
  };

  const login = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      console.error(e);
    }
  };

  const logout = () => signOut(auth);

  // CRUD Operations
  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'menuItems'), newItem);
      setNewItem({ category: categories[0]?.name.toLowerCase() || 'subs', title: '', desc: '', price: '', img: '' });
      fetchAdminData();
    } catch (e) {
      console.error(e);
      alert("Error adding item");
    }
  };

  
  const handleUpdateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem || !editingItem.id) return;
    try {
      await setDoc(doc(db, 'menuItems', editingItem.id), editingItem, { merge: true });
      setEditingItem(null);
      fetchAdminData();
    } catch(e) { console.error(e); }
  };

  const handleDeleteItem = async (id: string) => {
    
    try {
      await deleteDoc(doc(db, 'menuItems', id));
      fetchAdminData();
    } catch(e) { console.error(e); }
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'menuCategories'), newCat);
      setNewCat({ name: '', order: categories.length });
      fetchAdminData();
    } catch(e) { console.error(e); }
  };

  const handleDeleteCat = async (id: string) => {
    
    try {
      await deleteDoc(doc(db, 'menuCategories', id));
      fetchAdminData();
    } catch(e) { console.error(e); }
  };

  const handleAddReview = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'reviews'), {
        ...newReview,
        date: new Date().toLocaleDateString(),
        status: 'approved'
      });
      setNewReview({ author: '', text: '', rating: 5 });
      fetchAdminData();
    } catch(e) { console.error(e); }
  };

  const handleDeleteReview = async (id: string) => {
    
    try {
      await deleteDoc(doc(db, 'reviews', id));
      fetchAdminData();
    } catch(e) { console.error(e); }
  };

  const handleApproveReview = async (id: string) => {
    try {
      await setDoc(doc(db, 'reviews', id), { status: 'approved' }, { merge: true });
      fetchAdminData();
    } catch(e) { console.error(e); }
  };

  if (loading) return <div className="p-10 text-center">Loading...</div>;

  if (!user || user.email !== ADMIN_EMAIL) {
    return (
      <div className="min-h-full flex items-center justify-center p-6 bg-surface text-center">
        <div className="bg-surface-container p-8 rounded-3xl max-w-md w-full">
          <span className="material-symbols-outlined text-6xl text-primary mb-4">admin_panel_settings</span>
          <h2 className="text-2xl font-bold mb-6">Admin Access Only</h2>
          <p className="mb-8 text-on-surface-variant">Please sign in with the authorized admin account to access the dashboard.</p>
          <button onClick={login} className="bg-primary text-on-primary font-bold px-8 py-3 rounded-full hover:bg-primary/90">
            Sign In with Google
          </button>
        </div>
      </div>
    );
  }

  const filteredItems = items
    .filter(i => i.title.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => {
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      return (a.order ?? 99) - (b.order ?? 99);
    });

  return (
    <div className="min-h-full bg-background p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-headline text-primary">Admin Dashboard</h1>
          <div className="flex gap-4 items-center">
            <button onClick={logout} className="bg-surface-container-high px-4 py-2 rounded-lg hover:bg-surface-container-highest">
              Logout
            </button>
          </div>
        </div>

        <div className="flex gap-4 border-b border-outline-variant/30 mb-8">
          {['items', 'categories', 'reviews'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              className={`pb-2 px-4 capitalize ${activeTab === tab ? 'border-b-2 border-primary text-primary' : 'text-on-surface-variant'}`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* ITEMS TAB */}
        {activeTab === 'items' && (
          <div className="grid md:grid-cols-3 gap-8">
            <div className="md:col-span-1 bg-surface-container-low p-6 rounded-2xl">
              <h3 className="font-bold mb-4 text-xl">Add New Item</h3>
              <form onSubmit={handleAddItem} className="space-y-4">
                <div>
                  <label className="block text-sm mb-1 text-on-surface-variant">Title</label>
                  <input required value={newItem.title || ''} onChange={e => setNewItem({...newItem, title: e.target.value})} className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2 text-on-surface" />
                </div>
                <div>
                  <label className="block text-sm mb-1 text-on-surface-variant">Category</label>
                  <select required value={newItem.category || ''} onChange={e => setNewItem({...newItem, category: e.target.value})} className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2 text-on-surface">
                    {categories.map(c => <option key={c.id} value={c.name.toLowerCase()}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm mb-1 text-on-surface-variant">Price</label>
                  <input required value={newItem.price || ''} onChange={e => setNewItem({...newItem, price: e.target.value})} className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2 text-on-surface" />
                </div>
                <div>
                  <label className="block text-sm mb-1 text-on-surface-variant">Description</label>
                  <textarea value={newItem.desc || ''} onChange={e => setNewItem({...newItem, desc: e.target.value})} className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2 text-on-surface" />
                </div>
                <div>
                  <label className="block text-sm mb-1 text-on-surface-variant">Image URL (Cloudinary)</label>
                  <input value={newItem.img || ''} onChange={e => setNewItem({...newItem, img: e.target.value})} className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2 text-on-surface" />
                </div>
                <div>
                  <label className="block text-sm mb-1 text-on-surface-variant">Order Index</label>
                  <input type="number" required value={newItem.order ?? 99} onChange={e => setNewItem({...newItem, order: parseInt(e.target.value) || 0})} className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2 text-on-surface" />
                </div>
                <button type="submit" className="w-full bg-primary text-on-primary py-2 rounded font-bold hover:bg-primary/90">Add Item</button>
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
                {filteredItems.map(item => (
                  <div key={item.id} className="bg-surface-container-low p-4 rounded-xl border border-outline-variant/30 flex justify-between">
                    <div>
                      <h4 className="font-bold flex items-center gap-2">
                        <span className="bg-surface-container text-xs px-2 py-1 rounded font-mono">{item.order ?? 99}</span>
                        {item.title}
                      </h4>
                      <div className="text-sm text-primary mb-1">${item.price}</div>
                      <div className="text-xs text-on-surface-variant bg-surface-container inline-block px-2 py-1 rounded mb-2">
                        {item.category}
                      </div>
                      {item.img ? (
                        <div className="text-xs text-on-surface-variant bg-surface-container-high rounded p-1 max-w-[200px] sm:max-w-[300px] overflow-hidden text-ellipsis whitespace-nowrap" title={item.img}>
                          <a href={item.img} target="_blank" rel="noreferrer" className="text-primary hover:underline flex items-center gap-1">
                            <span className="material-symbols-outlined text-[14px]">link</span> Image URL
                          </a>
                        </div>
                      ) : (
                        <div className="text-xs text-error mt-1 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px]">warning</span> No Image
                        </div>
                      )}
                    </div>
                    <button onClick={() => setEditingItem(item)} className="text-primary hover:bg-primary/10 p-2 rounded h-fit mr-2">
      <span className="material-symbols-outlined">edit</span>
    </button>
    <button onClick={() => handleDeleteItem(item.id!)} className="text-error hover:bg-error/10 p-2 rounded h-fit">
                      <span className="material-symbols-outlined">delete</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* CATEGORIES TAB */}
        {activeTab === 'categories' && (
          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-surface-container-low p-6 rounded-2xl">
              <h3 className="font-bold mb-4 text-xl">Add Category</h3>
              <form onSubmit={handleAddCategory} className="space-y-4">
                <div>
                  <label className="block text-sm mb-1 text-on-surface-variant">Name</label>
                  <input required value={newCat.name || ''} onChange={e => setNewCat({...newCat, name: e.target.value})} className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2 text-on-surface" />
                </div>
                <div>
                  <label className="block text-sm mb-1 text-on-surface-variant">Order Index</label>
                  <input type="number" required value={newCat.order ?? categories.length + 1} onChange={e => setNewCat({...newCat, order: parseInt(e.target.value) || 0})} className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2 text-on-surface" />
                </div>
                <button type="submit" className="w-full bg-primary text-on-primary py-2 rounded font-bold hover:bg-primary/90">Add Category</button>
              </form>
            </div>
            <div className="space-y-4">
              {categories.map(cat => (
                <div key={cat.id} className="bg-surface-container-low p-4 rounded-xl border border-outline-variant/30 flex justify-between items-center">
                  <div className="flex items-center gap-4">
                    <span className="bg-surface-container w-8 h-8 flex items-center justify-center rounded font-bold">{cat.order}</span>
                    <h4 className="font-bold">{cat.name}</h4>
                  </div>
                  <button onClick={() => handleDeleteCat(cat.id!)} className="text-error hover:bg-error/10 p-2 rounded">
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
            <div className="md:col-span-1 bg-surface-container-low p-6 rounded-2xl">
              <h3 className="font-bold mb-4 text-xl">Add Manual Review</h3>
              <form onSubmit={handleAddReview} className="space-y-4">
                <div>
                  <label className="block text-sm mb-1 text-on-surface-variant">Author Name</label>
                  <input required value={newReview.author || ''} onChange={e => setNewReview({...newReview, author: e.target.value})} className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2 text-on-surface" />
                </div>
                <div>
                  <label className="block text-sm mb-1 text-on-surface-variant">Rating (1-5)</label>
                  <input type="number" min="1" max="5" required value={newReview.rating || 5} onChange={e => setNewReview({...newReview, rating: parseInt(e.target.value) || 5})} className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2 text-on-surface" />
                </div>
                <div>
                  <label className="block text-sm mb-1 text-on-surface-variant">Review Text</label>
                  <textarea required value={newReview.text || ''} onChange={e => setNewReview({...newReview, text: e.target.value})} className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2 text-on-surface" />
                </div>
                <button type="submit" className="w-full bg-primary text-on-primary py-2 rounded font-bold hover:bg-primary/90">Add Review</button>
              </form>
            </div>
            <div className="md:col-span-2 space-y-4">
              {reviews.map(review => (
                <div key={review.id} className={`bg-surface-container-low p-4 rounded-xl border ${review.status === 'pending' ? 'border-primary' : 'border-outline-variant/30'} flex justify-between`}>
                  <div>
                    <h4 className="font-bold flex items-center gap-2">
                      {review.author} <span className="text-primary font-normal">★ {review.rating}</span>
                      {review.status === 'pending' && <span className="text-xs bg-primary text-on-primary px-2 py-0.5 rounded-full uppercase tracking-wider">Pending</span>}
                    </h4>
                    <p className="text-on-surface-variant text-sm mt-1">{review.text}</p>
                    <span className="text-xs text-on-surface-variant/50">{review.date}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {review.status === 'pending' && (
                      <button onClick={() => handleApproveReview(review.id!)} className="text-primary hover:bg-primary/10 p-2 rounded h-fit" title="Approve">
                        <span className="material-symbols-outlined">check_circle</span>
                      </button>
                    )}
                    <button onClick={() => handleDeleteReview(review.id!)} className="text-error hover:bg-error/10 p-2 rounded h-fit" title="Delete">
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
                <input required value={editingItem.title} onChange={e => setEditingItem({...editingItem, title: e.target.value})} className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm mb-1 text-on-surface-variant">Category</label>
                <select required value={editingItem.category.toLowerCase()} onChange={e => setEditingItem({...editingItem, category: e.target.value})} className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2">
                  {categories.map(c => <option key={c.id} value={c.name.toLowerCase()}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1 text-on-surface-variant">Price</label>
                <input required value={editingItem.price} onChange={e => setEditingItem({...editingItem, price: e.target.value})} className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm mb-1 text-on-surface-variant">Description</label>
                <textarea value={editingItem.desc} onChange={e => setEditingItem({...editingItem, desc: e.target.value})} className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm mb-1 text-on-surface-variant">Image URL</label>
                <input value={editingItem.img} onChange={e => setEditingItem({...editingItem, img: e.target.value})} className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm mb-1 text-on-surface-variant">Order Index</label>
                <input type="number" required value={editingItem.order ?? 99} onChange={e => setEditingItem({...editingItem, order: parseInt(e.target.value) || 0})} className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2" />
              </div>
              <div className="flex gap-4 pt-4">
                <button type="button" onClick={() => setEditingItem(null)} className="flex-1 bg-surface-container text-on-surface py-2 rounded font-bold">Cancel</button>
                <button type="submit" className="flex-1 bg-primary text-on-primary py-2 rounded font-bold">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Admin;
