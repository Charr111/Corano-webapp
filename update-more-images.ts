import { collection, getDocs, updateDoc, doc } from 'firebase/firestore';
import { db } from './src/firebase.ts';

const mappings: Record<string, string> = {
  "Famous Crispy Barbecue": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786562666/5fb98303-32cf-4a0e-afc9-aa9bb86119d5.jpg",
  "Steak sub": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786562761/8d3eb35b-12d9-414c-8381-bba2f371b460.jpg",
  "Phileadephia (Beef)": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786562866/1ca986fb-07f1-42f7-9b50-f00aa2fef4d7.jpg",
  "Chicken BBQ": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786631886/219fc38b-3128-4684-b83d-6b5205025b03.jpg",
  "Steak sandwich light": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786632585/20ab082c-aa1a-48cc-84fa-36fbfd1310bc.jpg",
  "Chicken Avocado (BROWN BREAD 24cm)": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786562758/9bbb4997-bafc-4e0d-9b54-2f1c68806520.jpg",
  "Crispy sub": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786632027/513f42b9-de06-4103-8048-81d7e0ae11c4.jpg",
  "Chicken honey mustard": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786884443/16578856-c50d-44fa-8b1a-36c2c224684b.jpg",
  "Crab (BROWN BREAD 24cm)": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786884441/584d8aa2-4d6e-422d-b487-dd318d0bbf66.jpg",
  "Chicken Corano": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786562587/76fb7521-95f4-491c-b9f7-c6de8c7d24c9.jpg",
  "Chicken Salameh Thierry": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786562486/e09143d2-4bb0-4c49-83e5-f1c254e017c6.jpg",
  "Chicken Sub": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786562630/13d19ac6-3e77-4587-b6f3-ee3977b8745c.jpg",
  "Sub Marine": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786562635/9075410b-6e5a-429b-a308-b199ff0ff3a6.jpg",
  "Chicken sandwich (220g) sajj bread": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786884930/535f4c88-bc27-42fc-b8fd-722fad4b6adc.jpg",
  "Djej sandwich sajj bread": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786884930/535f4c88-bc27-42fc-b8fd-722fad4b6adc.jpg",
  "Tawouk sajj bread": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786563193/d3135661-8f75-47bb-ae1e-582112118510.jpg",
  "Potato Wedges M": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786891289/4716103-612x612.jpg",
  "Baked Potato medium": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786885092/4fa44525-0c2a-4326-a448-30220369a004.png",
  "Crispy Chicken Tenders": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786885996/e290bc62-873d-4b26-98ad-a14b15dfa762.png",
  "French fries Medium": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786891125/french-fry-box-7dcc4aa.jpg",
  "Baked Potato Large": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786885092/4fa44525-0c2a-4326-a448-30220369a004.png",
  "Mozzarella Sticks": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786563305/aab91673-5c0e-4e50-b72e-52d2de3567bc.jpg",
  "Potato Wedges L": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786891289/4716103-612x612.jpg",
  "French Fries XL": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786891125/french-fry-box-7dcc4aa.jpg",
  "Potato Wedges S": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786891289/4716103-612x612.jpg",
  "French fries box": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786891125/french-fry-box-7dcc4aa.jpg",
  "Crispy Platter": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786885996/e290bc62-873d-4b26-98ad-a14b15dfa762.png"
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
  
  const categories = {
    hotMezza: [] as string[],
    mezzaLebanese: [] as string[],
    burgers: [] as string[],
    pizza: [] as string[],
    falafel: [] as string[]
  };
  
  for (const docSnap of itemSnap.docs) {
    const data = docSnap.data();
    const cat = data.category ? data.category.toLowerCase() : '';
    
    if (cat.includes('hot mezza') || cat.includes('hotmezza')) categories.hotMezza.push(data.title);
    else if (cat.includes('mezza') && (cat.includes('lebanese') || cat === 'mezza')) categories.mezzaLebanese.push(data.title);
    else if (cat.includes('burger')) categories.burgers.push(data.title);
    else if (cat.includes('pizza')) categories.pizza.push(data.title);
    else if (cat.includes('falafel')) categories.falafel.push(data.title);
    
    // Some logic for exact matches because hot mezza and mezza lebanese might overlap if not careful
    // Actually let's just do exact matching on the known categories if possible
  }

  // Clear and rebuild based on exactly how they're stored in DB if needed. Let's just do a safer approach
  const cats = { hot_mezza: [], mezza_lebanese: [], burgers: [], pizza: [], falafel: [] };
  
  for (const docSnap of itemSnap.docs) {
    const data = docSnap.data();
    const cat = data.category ? data.category.toLowerCase() : '';
    
    if (cat === 'hot mezza') cats.hot_mezza.push(data.title);
    else if (cat === 'mezza lebanese' || cat === 'mezza') cats.mezza_lebanese.push(data.title);
    else if (cat === 'burgers' || cat === 'burger') cats.burgers.push(data.title);
    else if (cat === 'pizza' || cat === 'pizzas') cats.pizza.push(data.title);
    else if (cat === 'falafel' || cat === 'falafels') cats.falafel.push(data.title);
    
    if (mappings[data.title]) {
      const newUrl = formatUrl(mappings[data.title], data.title);
      await updateDoc(doc(db, 'menuItems', docSnap.id), { img: newUrl });
      console.log(`Updated: ${data.title} -> ${newUrl}`);
      updatedCount++;
    }
  }
  
  console.log(`Finished updating ${updatedCount} items.`);
  
  console.log("--- HOT MEZZA ITEMS ---");
  cats.hot_mezza.forEach(i => console.log(i));
  console.log("--- MEZZA LEBANESE ITEMS ---");
  cats.mezza_lebanese.forEach(i => console.log(i));
  console.log("--- BURGERS ITEMS ---");
  cats.burgers.forEach(i => console.log(i));
  console.log("--- PIZZA ITEMS ---");
  cats.pizza.forEach(i => console.log(i));
  console.log("--- FALAFEL ITEMS ---");
  cats.falafel.forEach(i => console.log(i));
  
  process.exit(0);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
