import { collection, getDocs, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from './src/firebase.ts';

const mappings: Record<string, string> = {
  "Chicken Livers ASBE": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786632361/b2f0b96f-e2c6-438d-9799-b84bb836c3c4.jpg",
  "Plate makanek": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786884816/014836d0-1680-4d3e-bff3-dbcba3037d4d.jpg",
  "Dozen Kebbe 2ras": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786886190/GAD0012.JPG.jpg",
  "Wara2 3enab": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786884872/959f05bb-a95b-4af1-bca4-2c4df68e87b4.jpg",
  "Motabal Medium": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786884866/9d96204d-52c8-4897-9d37-cab79563ae53.jpg",
  "Dozen Sambousek lahme": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786884566/d6ddde40-2f59-46de-aba0-ae2e70b132b4.jpg",
  "Mouajanet mchakale": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786884566/d6ddde40-2f59-46de-aba0-ae2e70b132b4.jpg",
  "Hummus Medium": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786884613/d93af901-c562-430b-8164-0363e54bd699.jpg",
  "Dozen Cheese rolls": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786884566/d6ddde40-2f59-46de-aba0-ae2e70b132b4.jpg",
  "Classic Burger": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786892081/9ae74cbf-b25e-436c-83b2-29aecb6ebf96.jpg",
  "BBQ Burger": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786891855/GAD02168.JPG.jpg",
  "Mozzarella Pane": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786884499/6f0dba2b-6611-44fc-bee8-1e1644a04eca.jpg",
  "Chicken breast Burger": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786563027/ce6bd39f-a608-4d35-855e-8096fa3f098a.jpg",
  "Cheddar Pane Burger": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786563002/5076b79e-ed8d-447a-b06b-2f9355c5e451.jpg",
  "Cheese burger": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786891855/GAD02168.JPG.jpg",
  "Crispy cheddar Burger": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786562987/58cce4f3-528c-4f8e-9526-9d48935f5148.jpg",
  "Lebanese Burger": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786562966/15981716-dc29-4fcf-bae7-47d455124c38.jpg",
  "Cheddar Cheese Burger": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786891855/GAD02168.JPG.jpg"
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
  
  for (const docSnap of itemSnap.docs) {
    const data = docSnap.data();
    
    // Delete "Add Cheese" item
    if (data.title === "Add Cheese") {
      await deleteDoc(doc(db, 'menuItems', docSnap.id));
      console.log(`Deleted item: Add Cheese`);
      continue;
    }
    
    // Update mappings
    if (mappings[data.title]) {
      const newUrl = formatUrl(mappings[data.title], data.title);
      await updateDoc(doc(db, 'menuItems', docSnap.id), { img: newUrl });
      console.log(`Updated: ${data.title} -> ${newUrl}`);
      updatedCount++;
    }
  }
  
  console.log(`Finished updating ${updatedCount} items.`);
  process.exit(0);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
