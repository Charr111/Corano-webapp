import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MenuItem, MenuCategory, StoreDataPayload } from '../types';
import BackToTop from '../components/BackToTop';
import { DEFAULT_LBP_RATE, formatStorePrice, StoreCurrency } from '../utils/currency';
import { fetchLiveStoreData, getCachedStoreData } from '../utils/r2DataClient';

const Menu = () => {
  const initialStore = getCachedStoreData();
  const sortedInitialCats = [...(initialStore.categories || [])].sort(
    (a, b) => (a.order ?? 99) - (b.order ?? 99)
  );

  const [categories, setCategories] = useState<MenuCategory[]>(sortedInitialCats);
  const [allItems, setAllItems] = useState<MenuItem[]>(initialStore.items || []);
  const [activeCategory, setActiveCategory] = useState<string>(
    sortedInitialCats[0]?.name.toLowerCase() || ''
  );
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loadingCats, setLoadingCats] = useState<boolean>(sortedInitialCats.length === 0);
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [storeCurrency, setStoreCurrency] = useState<StoreCurrency>(
    initialStore.settings?.currency === 'LBP' ? 'LBP' : 'USD'
  );
  const [exchangeRate, setExchangeRate] = useState<number>(
    initialStore.settings?.exchangeRate || DEFAULT_LBP_RATE
  );

  const categoryScrollRef = useRef<HTMLDivElement | null>(null);

  const applyStorePayload = (store: StoreDataPayload) => {
    const cats = [...(store.categories || [])].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    setCategories(cats);
    setAllItems(store.items || []);
    setStoreCurrency(store.settings?.currency === 'LBP' ? 'LBP' : 'USD');
    setExchangeRate(
      typeof store.settings?.exchangeRate === 'number' && store.settings.exchangeRate > 0
        ? store.settings.exchangeRate
        : DEFAULT_LBP_RATE
    );
    setActiveCategory((prev) => {
      if (
        prev &&
        cats.some(
          (c) =>
            c.name.toLowerCase() === prev.toLowerCase() ||
            c.id.toLowerCase() === prev.toLowerCase()
        )
      ) {
        return prev;
      }
      return cats[0]?.name.toLowerCase() || '';
    });
  };

  useEffect(() => {
    let mounted = true;
    fetchLiveStoreData()
      .then((liveStore) => {
        if (!mounted) return;
        applyStorePayload(liveStore);
      })
      .catch((err) => {
        console.error('Error refreshing live R2 menu data:', err);
      })
      .finally(() => {
        if (mounted) setLoadingCats(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const activeCategoryObj = categories.find(
    (c) =>
      c.name.toLowerCase() === activeCategory.toLowerCase() ||
      c.id.toLowerCase() === activeCategory.toLowerCase()
  );

  const trimmedQuery = searchQuery.trim().toLowerCase();

  const activeItems = allItems
    .filter((item) => {
      if (trimmedQuery) {
        const titleMatch = (item.title || '').toLowerCase().includes(trimmedQuery);
        const descMatch = (item.desc || '').toLowerCase().includes(trimmedQuery);
        return titleMatch || descMatch;
      }
      const itemCat = (item.category || '').toLowerCase().trim();
      const targetName = activeCategory.toLowerCase().trim();
      const targetId = (activeCategoryObj?.id || '').toLowerCase().trim();
      return itemCat === targetName || (targetId && itemCat === targetId);
    })
    .sort((a, b) => {
      const aPop = a.popular ? 1 : 0;
      const bPop = b.popular ? 1 : 0;
      if (aPop !== bPop) return bPop - aPop;
      return (a.order ?? 99) - (b.order ?? 99);
    });

  const handleCategoryClick = (
    catNameLower: string,
    e: React.MouseEvent<HTMLButtonElement>
  ) => {
    setActiveCategory(catNameLower);
    if (searchQuery) setSearchQuery('');

    // Pure horizontal scroll centering on the category container only (never scrollIntoView)
    const container = categoryScrollRef.current;
    const btn = e.currentTarget;
    if (container && btn) {
      const targetLeft =
        btn.offsetLeft - container.clientWidth / 2 + btn.offsetWidth / 2;
      container.scrollTo({
        left: Math.max(0, targetLeft),
        behavior: 'smooth',
      });
    }
  };

  if (loadingCats) {
    return (
      <div className="min-h-full pt-16 md:pt-0 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="relative min-h-full py-8 px-4 sm:px-6 lg:px-8 bg-background">
      <div className="relative z-10 max-w-7xl mx-auto">
        <div className="text-center mb-6 md:mb-8">
          <h1 className="font-headline text-3xl md:text-4xl text-primary mb-2">Our Menu</h1>
          <div className="w-20 h-1 bg-primary mx-auto rounded-full mt-4"></div>
        </div>

        {/* Instant Menu Search Bar (Below heading, above category bar) */}
        <div className="max-w-md mx-auto mb-6">
          <div className="relative flex items-center">
            <span className="material-symbols-outlined text-[20px] text-on-surface-variant absolute left-3.5 pointer-events-none">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search dishes or ingredients..."
              aria-label="Search menu items"
              className="w-full bg-[#181818] border border-outline-variant/40 focus:border-[#E4CD86] rounded-xl pl-10 pr-10 py-2.5 text-base sm:text-sm text-on-surface placeholder-on-surface-variant/60 focus:outline-none transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-2.5 min-w-[32px] min-h-[32px] flex items-center justify-center text-on-surface-variant hover:text-primary transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            )}
          </div>
        </div>

        {/* Categories Tab Bar */}
        <div className="pb-2 mb-8 -mx-4 px-4 sm:mx-0 sm:px-0">
          <div
            ref={categoryScrollRef}
            className="flex overflow-x-auto hide-scrollbar border-b border-outline-variant/30 gap-6 justify-start"
          >
            {categories.map((cat) => {
              const isSelected = !trimmedQuery && activeCategory === cat.name.toLowerCase();
              return (
                <button
                  key={cat.id}
                  onClick={(e) => handleCategoryClick(cat.name.toLowerCase(), e)}
                  className={`font-headline whitespace-nowrap pb-3 mb-2 px-2 text-lg font-medium transition-colors relative ${
                    isSelected ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {cat.name}
                  {isSelected && (
                    <motion.div
                      layoutId="activeCategory"
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Items Grid */}
        <motion.div 
          layout
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          <AnimatePresence mode="popLayout">
            {activeItems.map((item) => (
              <motion.div
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                key={item.id}
                onClick={() => setSelectedItem(item)}
                className="bg-surface-container-low rounded-2xl overflow-hidden border border-outline-variant/20 cursor-pointer hover:border-primary/50 transition-colors flex md:flex-col"
              >
                <div className="w-32 h-32 md:w-full md:h-48 shrink-0 bg-surface-container relative">
                  {item.available !== false && item.popular && (
                    <div className="absolute top-3 left-3 bg-[#101010]/90 text-[#E4CD86] border border-[#E4CD86]/50 font-bold text-[10px] uppercase tracking-wider px-2 py-1 rounded-full z-10 shadow-md">
                      ★ Popular
                    </div>
                  )}
                  {item.available === false ? (
                    <div className="absolute top-2 right-2 bg-error text-on-error font-bold text-[10px] uppercase tracking-wider px-2 py-1 rounded-full z-10 shadow-md">
                      Out of Stock
                    </div>
                  ) : item.isNew ? (
                    <div className="absolute top-2 right-2 bg-error text-on-error font-bold text-[10px] uppercase tracking-wider px-2 py-1 rounded-full z-10 shadow-md">
                      New Item
                    </div>
                  ) : null}
                  {item.img ? (
                    <img 
                      src={item.img} 
                      alt={item.title} 
                      className={`w-full h-full object-cover md:group-hover:scale-105 transition-transform duration-500 ${item.available === false ? 'opacity-50 grayscale-[40%]' : ''}`}
                      loading={activeCategory === categories[0]?.name.toLowerCase() ? "eager" : "lazy"}
                      fetchPriority={activeCategory === categories[0]?.name.toLowerCase() ? "high" : "auto"}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="material-symbols-outlined text-4xl text-outline-variant">restaurant</span>
                    </div>
                  )}
                </div>
                <div className="p-4 flex flex-col flex-grow justify-center">
                  <div className="flex flex-col md:flex-row md:justify-between md:items-start mb-2">
                    <h3 className="font-headline text-lg md:text-xl text-on-surface leading-tight mb-1 md:mb-0 pr-2">{item.title}</h3>
                    <span className="font-bold text-primary whitespace-nowrap">
                      {formatStorePrice(item.price, storeCurrency, exchangeRate)}
                    </span>
                  </div>
                  {item.available === false ? (
                    <p className="text-xs text-error font-bold mt-1">
                      Out of Stock
                    </p>
                  ) : (item.desc || (item.addons && item.addons.length > 0)) ? (
                    <p className="text-sm text-primary italic font-semibold mt-1">
                      View Ingredients
                    </p>
                  ) : null}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
        
        {activeItems.length === 0 && (
          <div className="text-center text-on-surface-variant py-12">
            {trimmedQuery
              ? `No menu items found matching "${searchQuery.trim()}".`
              : 'No items available in this category yet.'}
          </div>
        )}
      </div>

      {/* Item Details Popup (Full-Bleed Top Dish Photo) */}
      <AnimatePresence>
        {selectedItem && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] flex items-end md:items-center justify-center bg-black/80 backdrop-blur-sm sm:p-4"
            onClick={() => setSelectedItem(null)}
          >
            <motion.div 
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface-container w-full max-w-2xl rounded-t-3xl md:rounded-3xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="relative w-full h-64 md:h-80 bg-surface-container-lowest shrink-0 overflow-hidden">
                {selectedItem.img ? (
                  <img
                    src={selectedItem.img}
                    alt={selectedItem.title}
                    className="w-full h-full object-contain p-2 bg-surface"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="material-symbols-outlined text-6xl text-outline-variant">restaurant</span>
                  </div>
                )}
                {selectedItem.available !== false && selectedItem.popular && (
                  <div className="absolute top-3 left-3 bg-[#101010]/90 text-[#E4CD86] border border-[#E4CD86]/50 font-bold text-xs uppercase tracking-wider px-3 py-1 rounded-full shadow-md">
                    ★ Popular
                  </div>
                )}
                <button 
                  onClick={() => setSelectedItem(null)} 
                  aria-label="Close item details"
                  className="absolute top-3 right-3 bg-black/60 backdrop-blur-md text-white rounded-full p-2 hover:bg-black/80 transition-colors"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <div className="p-6 md:p-8 flex flex-col overflow-y-auto hide-scrollbar pb-safe">
                <div className="flex justify-between items-start mb-4">
                  <h2 className="font-headline text-2xl md:text-3xl text-on-surface pr-4">{selectedItem.title}</h2>
                  <span className="text-2xl font-bold text-primary whitespace-nowrap">
                    {formatStorePrice(selectedItem.price, storeCurrency, exchangeRate)}
                  </span>
                </div>
                <p className="font-headline text-on-surface-variant leading-relaxed text-lg mb-4 whitespace-pre-wrap">
                  {selectedItem.desc}
                </p>
                {selectedItem.addons && selectedItem.addons.length > 0 && (
                  <div className="mb-8 p-4 bg-surface rounded-xl border border-outline-variant/30">
                    <h4 className="font-headline text-sm font-bold text-on-surface mb-2">Options & Add-ons</h4>
                    <ul className="space-y-2">
                      {selectedItem.addons.map((addon, idx) => (
                        <li key={idx} className="font-headline text-sm text-on-surface-variant flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0"></span>
                          {addon}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {selectedItem.available === false && (
                   <div className="bg-error/10 text-error px-4 py-3 rounded-xl text-center font-bold">
                     Out of Stock
                   </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <BackToTop />
    </div>
  );
};

export default Menu;
