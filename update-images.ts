import { collection, getDocs, updateDoc, doc } from 'firebase/firestore';
import { db } from './src/firebase.ts';

const mappings: Record<string, string> = {
  "Djej Special": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786563078/cb5f7764-abed-4470-beb8-eb022954735c.jpg",
  "Sheep Meat لحم غنم": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786563133/8dcbc2e7-8e90-49a1-bf11-1057581231b0.jpg",
  "Sand. Tawouk 3al Fahem": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786563110/4181cb7d-aa75-4447-a192-9e84faedcc69.jpg",
  "Sandwich Asbe (chicken liver)": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786563136/1039b965-b11d-4153-880a-934516237dfd.jpg",
  "Djeij 3al Fahem": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786563078/cb5f7764-abed-4470-beb8-eb022954735c.jpg",
  "Makanek": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786563154/199ea9b8-7a35-4a21-be5d-4a7e8aa88e02.jpg",
  "Fries Sando": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786632620/9a09753a-b690-4c21-b9fa-465e48a76251.jpg",
  "Special Tawouk": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786563110/4181cb7d-aa75-4447-a192-9e84faedcc69.jpg",
  "Kabab": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786884368/64326328-7b86-4dfe-8a26-a62a2c4c6ba4.jpg",
  "Cheese Kafta": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786884379/PM.png",
  "Sandwich djej sfine": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786563078/cb5f7764-abed-4470-beb8-eb022954735c.jpg",
  "Kafta": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786884379/PM.png",
  "Tawouk Arabic Bread": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786563110/4181cb7d-aa75-4447-a192-9e84faedcc69.jpg",
  "Quinoa salad": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786563407/987be338-4cad-47cf-9938-e35ce9205fd6.jpg",
  "Tuna Pasta": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786632686/82238091-674f-4ca7-85d9-570293926ec0.jpg",
  "Chef Salad": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786632702/e4dc41b6-32a2-4566-8840-7e2f15d6c821.jpg",
  "Tabbouleh LARGE": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786888870/images.jpg",
  "Tabbouleh MEDIUM": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786888870/images.jpg",
  "Corano salad": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786884697/46b3e002-b4ef-4993-866f-2d76c7c91875.jpg",
  "Fatouche SMALL": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786632694/7f4f8c76-c58b-4337-914c-d6a42c36e6ed.jpg",
  "Fatouche LARGE": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786632694/7f4f8c76-c58b-4337-914c-d6a42c36e6ed.jpg",
  "Tabbouleh SMALL": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786888870/images.jpg",
  "Fatouche MEDIUM": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786632694/7f4f8c76-c58b-4337-914c-d6a42c36e6ed.jpg"
};

function formatUrl(originalUrl: string, name: string): string {
  // original: https://res.cloudinary.com/wlgd4zum/image/upload/v1786563078/cb5f7764-abed-4470-beb8-eb022954735c.jpg
  // target: https://res.cloudinary.com/wlgd4zum/image/upload/f_auto,q_auto,w_600,c_limit/v1786563078/cb5f7764-abed-4470-beb8-eb022954735c.jpg?name=Djej-Special
  
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
    if (mappings[data.title]) {
      const newUrl = formatUrl(mappings[data.title], data.title);
      await updateDoc(doc(db, 'menuItems', docSnap.id), { img: newUrl });
      console.log(`Updated: ${data.title} -> ${newUrl}`);
      updatedCount++;
    }
  }
  
  console.log(`Finished updating ${updatedCount} items.`);
  
  // Now list "mashewe" items
  const masheweItems = itemSnap.docs.map(d => d.data()).filter(i => i.category.toLowerCase() === 'mashewe' || i.category.toLowerCase() === 'mashawi' || i.category.toLowerCase() === 'grill');
  console.log("--- MASHEWE ITEMS ---");
  masheweItems.forEach(i => console.log(i.title));
  
  process.exit(0);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
