import { collection, getDocs, updateDoc, doc, deleteDoc, addDoc } from 'firebase/firestore';
import { db } from './src/firebase.ts';

const updates: Record<string, any> = {
  "Kabis box": { price: "0.56", img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1786915831/images_19.jpg" },
  "Cup mayonnaise": { title: "Mayonnaise Cup", img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1787158053/photo_2026-08-19_19-30-42.jpg" },
  "Honey mustard sauce cup": { img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1787158143/photo_2026-08-19_19-30-21.jpg" },
  "Reb 7ar": { img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1787158070/photo_2026-08-19_19-30-37.jpg" },
  "Toum w 7ar": { img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1787157483/photo_2026-08-19_19-31-42.jpg" },
  "Add cocktail sauce cup": { title: "Cocktail sauce cup", img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1787158033/photo_2026-08-19_19-30-44.jpg" },
  "Garlic small cup": { img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1787157507/photo_2026-08-19_19-31-32.jpg" },
  "Garlic large cup": { img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1787157507/photo_2026-08-19_19-31-32.jpg" },
  "Add Caesar sauce cup": { title: "Caesar sauce cup", img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1787157515/photo_2026-08-19_19-31-22.jpg" },
  "Add Aioli sauce cup": { title: "Aioli sauce cup", img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1787157824/photo_2026-08-19_19-30-56.jpg" },
  "Cup Hummus": { title: "Hummus Cup", img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1787157475/photo_2026-08-19_19-31-46.jpg" },
  "Steak sauce": { img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1787157770/photo_2026-08-19_19-31-10.jpg" },
  "Add Garlic Cup": { title: "Garlic Cup", img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1787157507/photo_2026-08-19_19-31-32.jpg" },
  "Add cheddar sauce": { title: "Cheddar sauce", img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1787157465/photo_2026-08-19_19-31-50.jpg" },
  "Add barbecue sauce cup": { title: "Barbecue sauce cup", img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1787157932/photo_2026-08-19_19-30-52.jpg" }
};

const toDelete = ["Taratour 250 gr", "Cup taratour"];

const newItems = [
  { title: "Lemon Mustard", price: "0.56", img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1787157491/photo_2026-08-19_19-31-39.jpg" },
  { title: "Balsamic", price: "0.56", img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1787157749/photo_2026-08-19_19-31-16.jpg" },
  { title: "Debes Remmen", price: "0.56", img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1787157499/photo_2026-08-19_19-31-35.jpg" },
  { title: "Burger Sauce", price: "0.56", img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1787157778/photo_2026-08-19_19-31-00.jpg" },
  { title: "Thiery Sauce", price: "0.56", img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1787158062/photo_2026-08-19_19-30-39.jpg" }
];

function formatUrl(originalUrl: string, name: string): string {
  if (!originalUrl.includes('/upload/')) return originalUrl;
  const parts = originalUrl.split('/upload/');
  const safeName = encodeURIComponent(name.replace(/ /g, '_'));
  return `${parts[0]}/upload/f_auto,q_auto,w_600,c_limit/${parts[1]}?item=${safeName}`;
}

async function run() {
  const itemSnap = await getDocs(collection(db, 'menuItems'));
  let updatedCount = 0;
  let deletedCount = 0;
  let addedCount = 0;
  
  let sauceCategory = 'sauce cups'; // fallback
  
  for (const docSnap of itemSnap.docs) {
    const data = docSnap.data();
    const title = data.title;
    
    if (toDelete.includes(title)) {
      await deleteDoc(doc(db, 'menuItems', docSnap.id));
      console.log(`Deleted: ${title}`);
      deletedCount++;
      continue;
    }

    if (updates[title]) {
      const up = updates[title];
      const newTitle = up.title || title;
      sauceCategory = data.category || sauceCategory; 

      const updatedData: any = {
        img: formatUrl(up.img, newTitle)
      };
      if (up.title) updatedData.title = up.title;
      if (up.price) updatedData.price = up.price;

      await updateDoc(doc(db, 'menuItems', docSnap.id), updatedData);
      console.log(`Updated: ${title} -> ${newTitle}`);
      updatedCount++;
    }
  }
  
  for (const item of newItems) {
    const newItem = {
      title: item.title,
      price: item.price,
      category: sauceCategory,
      desc: "",
      order: 99,
      img: formatUrl(item.img, item.title)
    };
    await addDoc(collection(db, 'menuItems'), newItem);
    console.log(`Added: ${item.title}`);
    addedCount++;
  }
  
  console.log(`\nFinished: Updated ${updatedCount}, Deleted ${deletedCount}, Added ${addedCount}`);
  process.exit(0);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
