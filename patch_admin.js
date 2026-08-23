import fs from 'fs';
let code = fs.readFileSync('src/pages/Admin.tsx', 'utf8');

// 1. Add editingItem state
code = code.replace(
  /const \[newItem, setNewItem\] = useState<Partial<MenuItem>>\(\{\}\);/,
  `const [newItem, setNewItem] = useState<Partial<MenuItem>>({});\n  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);`
);

// 2. Add handleUpdateItem logic
const updateLogic = `
  const handleUpdateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem || !editingItem.id) return;
    try {
      await setDoc(doc(db, 'menuItems', editingItem.id), editingItem, { merge: true });
      setEditingItem(null);
      fetchAdminData();
    } catch(e) { console.error(e); }
  };
`;
code = code.replace(
  /const handleDeleteItem = async \(id: string\) => \{/,
  `${updateLogic}\n  const handleDeleteItem = async (id: string) => {`
);

// 3. Add Edit Button in the list
code = code.replace(
  /<button onClick=\{\(\) => handleDeleteItem\(item\.id!\)\} className="text-error hover:bg-error\/10 p-2 rounded h-fit">/,
  `<button onClick={() => setEditingItem(item)} className="text-primary hover:bg-primary/10 p-2 rounded h-fit mr-2">
      <span className="material-symbols-outlined">edit</span>
    </button>
    <button onClick={() => handleDeleteItem(item.id!)} className="text-error hover:bg-error/10 p-2 rounded h-fit">`
);

// 4. Add the Modal at the bottom, just before the closing </div></div> of the page.
const modalCode = `
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
                <textarea required value={editingItem.desc} onChange={e => setEditingItem({...editingItem, desc: e.target.value})} className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm mb-1 text-on-surface-variant">Image URL</label>
                <input value={editingItem.img} onChange={e => setEditingItem({...editingItem, img: e.target.value})} className="w-full bg-surface-container border border-outline/50 rounded px-3 py-2" />
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
`;
code = code.replace(/    <\/div>\n  \);\n\};\n/g, modalCode);

fs.writeFileSync('src/pages/Admin.tsx', code);
