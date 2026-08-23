import { collection, getDocs, updateDoc, doc } from 'firebase/firestore';
import { db } from './src/firebase.ts';

const mappings: Record<string, string> = {
  "Barbecue Half Chicken Dine In": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786563238/11d3eea5-1860-443f-9b0a-3a33b9618e08.jpg",
  "1kg kabab": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786884995/894754b7-2e5b-4c61-886c-cc5f5defc237.jpg",
  "Mixed Grill extra": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786563234/e6f1abfa-4d48-4c1b-845c-422f7ee2c761.jpg",
  "1kg kafta": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786884995/894754b7-2e5b-4c61-886c-cc5f5defc237.jpg",
  "1/2 kg kafta": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786884995/894754b7-2e5b-4c61-886c-cc5f5defc237.jpg",
  "Kafta": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786884995/894754b7-2e5b-4c61-886c-cc5f5defc237.jpg",
  "Mix Grilled 1 kg": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786563234/e6f1abfa-4d48-4c1b-845c-422f7ee2c761.jpg",
  "Barbecue chicken whole ( farouj) Dine In": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786563238/11d3eea5-1860-443f-9b0a-3a33b9618e08.jpg",
  "Kabab": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786884995/894754b7-2e5b-4c61-886c-cc5f5defc237.jpg",
  "1kg Mixed Grill Extra": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786563234/e6f1abfa-4d48-4c1b-845c-422f7ee2c761.jpg",
  "Half kilo mixed grilled extra": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786563234/e6f1abfa-4d48-4c1b-845c-422f7ee2c761.jpg",
  "Grilled chicken breast (2 pieces)": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786631857/6af07912-4b4d-49fd-9933-64ce47529b23.jpg",
  "Grilled chicken breast (1 piece)": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786631857/6af07912-4b4d-49fd-9933-64ce47529b23.jpg",
  "1/2 kg kabab": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786884995/894754b7-2e5b-4c61-886c-cc5f5defc237.jpg",
  "Barbecue Half Chicken": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786563238/11d3eea5-1860-443f-9b0a-3a33b9618e08.jpg",
  "Mixed Grilled": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786563234/e6f1abfa-4d48-4c1b-845c-422f7ee2c761.jpg",
  "Barbecue chicken whole ( farouj) delivery": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786563238/11d3eea5-1860-443f-9b0a-3a33b9618e08.jpg"
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
  
  const subs: string[] = [];
  const sajj: string[] = [];
  const appetizers: string[] = [];
  
  for (const docSnap of itemSnap.docs) {
    const data = docSnap.data();
    const cat = data.category ? data.category.toLowerCase() : '';
    
    if (cat === 'subs') subs.push(data.title);
    else if (cat === 'sajj') sajj.push(data.title);
    else if (cat === 'appetizers' || cat === 'appetizer') appetizers.push(data.title);
    
    if (mappings[data.title]) {
      if ((data.title === "Kafta" || data.title === "Kabab") && cat !== "mashewe") {
        continue;
      }
      
      const newUrl = formatUrl(mappings[data.title], data.title);
      await updateDoc(doc(db, 'menuItems', docSnap.id), { img: newUrl });
      console.log(`Updated: ${data.title} -> ${newUrl}`);
      updatedCount++;
    }
  }
  
  console.log(`Finished updating ${updatedCount} items.`);
  
  console.log("--- SUBS ITEMS ---");
  subs.forEach(i => console.log(i));
  console.log("--- SAJJ ITEMS ---");
  sajj.forEach(i => console.log(i));
  console.log("--- APPETIZERS ITEMS ---");
  appetizers.forEach(i => console.log(i));
  
  process.exit(0);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
