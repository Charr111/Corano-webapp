import { collection, getDocs, updateDoc, doc } from 'firebase/firestore';
import { db } from './src/firebase.ts';

const mappings: Record<string, string> = {
  "Boule nutella": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786900098/images_17.jpg",
  "Jello": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786900103/images_16.jpg",
  "Custard": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786900109/images_15.jpg"
};

function formatUrl(originalUrl: string, name: string): string {
  if (!originalUrl.includes('/upload/')) return originalUrl;
  const parts = originalUrl.split('/upload/');
  const safeName = encodeURIComponent(name.replace(/ /g, '_'));
  return `${parts[0]}/upload/f_auto,q_auto,w_600,c_limit/${parts[1]}?item=${safeName}`;
}

async function run() {
  const itemSnap = await getDocs(collection(db, 'menuItems'));
  let updatedCount = 0;
  
  const sauceCups: string[] = [];

  for (const docSnap of itemSnap.docs) {
    const data = docSnap.data();
    const cat = data.category ? data.category.toLowerCase() : '';
    
    if (cat.includes('sauce') || cat.includes('cup')) {
      sauceCups.push(data.title);
    }

    if (mappings[data.title]) {
      const newUrl = formatUrl(mappings[data.title], data.title);
      await updateDoc(doc(db, 'menuItems', docSnap.id), { img: newUrl });
      console.log(`Updated: ${data.title} -> ${newUrl}`);
      updatedCount++;
    }
  }

  console.log(`Finished updating ${updatedCount} items.`);
  console.log("--- SAUCE CUPS ITEMS ---");
  sauceCups.forEach(i => console.log(i));
  process.exit(0);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
