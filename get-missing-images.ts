import { collection, getDocs } from 'firebase/firestore';
import { db } from './src/firebase.ts';

async function run() {
  try {
    const snap = await getDocs(collection(db, 'menuItems'));
    const missing: { title: string, category: string }[] = [];
    
    snap.forEach((doc) => {
      const data = doc.data();
      if (!data.img || data.img.trim() === '') {
        missing.push({
          title: data.title || 'Unknown',
          category: data.category || 'Unknown'
        });
      }
    });
    
    const grouped = missing.reduce((acc, item) => {
      if (!acc[item.category]) acc[item.category] = [];
      acc[item.category].push(item.title);
      return acc;
    }, {} as Record<string, string[]>);
    
    Object.entries(grouped).forEach(([cat, items]) => {
      console.log(`\n**${cat.toUpperCase()}**`);
      items.forEach(item => console.log(`- ${item}`));
    });

  } catch (error) {
    console.error("Error:", error);
  }
  process.exit(0);
}

run();
