import { collection, getDocs, updateDoc, doc } from 'firebase/firestore';
import { db } from './src/firebase.ts';

const updates: Record<string, string> = {
  "Phileadephia (Beef)": "Philadelphia (Beef)",
  "Steack sauce": "Steak sauce",
  "Cappucino": "Cappuccino",
  "Add ceaser sauce cup": "Add Caesar sauce cup",
  "Cafe late 2in1": "Cafe Latte 2in1",
  "Miranda": "Mirinda",
  "Miranda 1.25L": "Mirinda 1.25L",
  "Tandory": "Tandoori",
  "Sub Marine": "Submarine",
  "Cup homos": "Cup Hummus",
  "Soujuk": "Soujouk",
  "Sejok Sajj bread": "Soujouk Sajj bread",
  "Djeij aal fahem Bl sub": "Djej aal fahem Bl sub",
  "Season Small": "Seasonal Salad Small",
  "Season MEDIUM": "Seasonal Salad Medium",
  "Season LARGE": "Seasonal Salad Large",
  "H2o lemon": "H2O lemon",
  "Barbecue chicken whole ( farouj) Dine In": "Barbecue chicken whole (farouj) Dine In",
  "7up Reg./Diet  1.25 l": "7up Reg./Diet  1.25 L",
  "Crispy cheddar Burger": "Crispy Cheddar Burger"
};

async function run() {
  const itemSnap = await getDocs(collection(db, 'menuItems'));
  let updatedCount = 0;
  const emptyItems: string[] = [];
  
  for (const docSnap of itemSnap.docs) {
    const data = docSnap.data();
    let title = data.title;
    
    if (updates[title]) {
      title = updates[title];
      await updateDoc(doc(db, 'menuItems', docSnap.id), { title });
      console.log(`Fixed typo: ${data.title} -> ${title}`);
      updatedCount++;
    }
    
    if (!data.img || data.img.trim() === '') {
      emptyItems.push(title);
    }
  }
  
  console.log(`\nFinished updating ${updatedCount} items.`);
  console.log("\n--- ITEMS WITH NO IMAGES ---");
  emptyItems.sort((a, b) => a.localeCompare(b)).forEach(i => console.log(i));
  process.exit(0);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
