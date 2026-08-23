import { collection, getDocs, updateDoc, doc } from 'firebase/firestore';
import { db } from './src/firebase.ts';

async function run() {
  const itemSnap = await getDocs(collection(db, 'menuItems'));
  
  // Group by category
  const categorized: Record<string, any[]> = {};
  
  for (const docSnap of itemSnap.docs) {
    const data = docSnap.data();
    const cat = data.category || 'uncategorized';
    if (!categorized[cat]) categorized[cat] = [];
    categorized[cat].push({ id: docSnap.id, ...data });
  }
  
  let updatedCount = 0;
  
  for (const cat of Object.keys(categorized)) {
    const items = categorized[cat];
    // Sort alphabetically by title
    items.sort((a, b) => a.title.localeCompare(b.title));
    
    // Assign new order
    let orderCounter = 10;
    for (const item of items) {
      if (item.order !== orderCounter) {
        await updateDoc(doc(db, 'menuItems', item.id), { order: orderCounter });
        updatedCount++;
      }
      orderCounter += 10;
    }
  }
  
  console.log(`Successfully reordered all categories. Updated ${updatedCount} items.`);
  process.exit(0);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
