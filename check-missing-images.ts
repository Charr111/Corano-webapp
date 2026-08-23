import { collection, getDocs } from 'firebase/firestore';
import { db } from './src/firebase.ts';

async function run() {
  try {
    const itemsSnap = await getDocs(collection(db, 'menuItems'));
    const missingImages: { title: string, category: string }[] = [];
    
    itemsSnap.forEach((doc) => {
      const data = doc.data();
      // Check if img is undefined, null, or an empty string
      if (!data.img || data.img.trim() === '') {
        missingImages.push({
          title: data.title || 'Unknown Title',
          category: data.category || 'Unknown Category'
        });
      }
    });

    console.log("--- ITEMS MISSING IMAGES ---");
    if (missingImages.length === 0) {
      console.log("All items have images.");
    } else {
      missingImages.forEach(item => {
        console.log(`- ${item.title} (Category: ${item.category})`);
      });
    }
  } catch (error) {
    console.error("Error fetching items:", error);
  }
  process.exit(0);
}

run();
