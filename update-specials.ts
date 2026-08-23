import { collection, getDocs, updateDoc, doc } from 'firebase/firestore';
import { db } from './src/firebase.ts';

const imgUpdates: Record<string, string> = {
  "Potato Wedges S": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786915613/wmremove-transformed.webp",
  "Potato Wedges M": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786915613/wmremove-transformed.webp",
  "Potato Wedges L": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786915613/wmremove-transformed.webp",
  "BBQ Burger": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786884480/35ed3434-0bc1-41bd-9be7-2b4a77983fd9.jpg"
};

function formatUrl(originalUrl: string, name: string): string {
  if (!originalUrl.includes('/upload/')) return originalUrl;
  const parts = originalUrl.split('/upload/');
  const safeName = encodeURIComponent(name.replace(/ /g, '_'));
  return `${parts[0]}/upload/f_auto,q_auto,w_600,c_limit/${parts[1]}?item=${safeName}`;
}

// Function to calculate a priority score for items based on rules
function getPriorityScore(title: string, category: string): number {
  const t = title.toLowerCase();
  const c = category.toLowerCase();

  // "farouj meshwe i need them first all kind"
  if (t.includes('farouj') || t.includes('farrouj') || t.includes('barbecue half chicken') || t.includes('barbecue chicken')) return 1;
  
  // "fries also" (Assuming this is in appetizers or sides)
  if (t.includes('fries') || t.includes('french fries')) return 1;

  // "tabbouleh and fatouche"
  if (t.includes('tabbouleh') || t.includes('fatouche') || t.includes('fattoush')) return 1;

  // "djeij also in sandwiches"
  if (c.includes('sandwich') && (t.includes('djeij') || t.includes('djej'))) return 1;

  // "cheddar pane burger and mozzarella pane and crrispy cheddar burger in burgers"
  if (c.includes('burger')) {
    if (t.includes('cheddar pane') || t.includes('mozzarella pane') || t.includes('crispy cheddar')) return 1;
  }

  // "Chicken Salameh Thierry, Chicken Sub, Chicken Corano and Chicken Avocado (BROWN BREAD 24cm) in subs."
  if (c.includes('sub')) {
    if (t.includes('salameh thierry') || t.includes('chicken sub') || t.includes('chicken corano') || t.includes('chicken avocado')) return 1;
  }

  return 999; // Not prioritized
}

async function run() {
  const itemSnap = await getDocs(collection(db, 'menuItems'));
  let imgUpdatedCount = 0;
  
  const categorizedItems: Record<string, any[]> = {};
  
  // 1. Update Images and group for sorting
  for (const docSnap of itemSnap.docs) {
    const data = docSnap.data();
    
    // Check if image needs update
    if (imgUpdates[data.title]) {
      data.img = formatUrl(imgUpdates[data.title], data.title);
      await updateDoc(doc(db, 'menuItems', docSnap.id), { img: data.img });
      console.log(`Updated Image: ${data.title} -> ${data.img}`);
      imgUpdatedCount++;
    }

    const cat = data.category ? data.category.toLowerCase() : 'uncategorized';
    if (!categorizedItems[cat]) categorizedItems[cat] = [];
    categorizedItems[cat].push({ id: docSnap.id, ...data });
  }
  
  let orderUpdatedCount = 0;

  // 2. Sort and reassign order
  for (const cat of Object.keys(categorizedItems)) {
    const items = categorizedItems[cat];
    
    // Sort by priority first (1 vs 999), then alphabetically
    items.sort((a, b) => {
      const scoreA = getPriorityScore(a.title, a.category || '');
      const scoreB = getPriorityScore(b.title, b.category || '');
      
      if (scoreA !== scoreB) {
        return scoreA - scoreB;
      }
      return a.title.localeCompare(b.title);
    });
    
    // Reassign order starting from 10
    let order = 10;
    for (const item of items) {
      if (item.order !== order) {
        await updateDoc(doc(db, 'menuItems', item.id), { order });
        orderUpdatedCount++;
      }
      order += 10;
    }
  }

  console.log(`Finished updating ${imgUpdatedCount} images and reordered ${orderUpdatedCount} items.`);
  process.exit(0);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
