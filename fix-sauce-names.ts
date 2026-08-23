import { collection, getDocs, updateDoc, doc } from 'firebase/firestore';
import { db } from './src/firebase.ts';

async function run() {
  const itemSnap = await getDocs(collection(db, 'menuItems'));
  let sauceCategory = "";
  
  // Find the category of Kabis box or Mayonnaise Cup to accurately target the sauce category
  for (const docSnap of itemSnap.docs) {
    const data = docSnap.data();
    if (data.title === "Kabis box" || data.title === "Mayonnaise Cup") {
      sauceCategory = data.category;
      break;
    }
  }

  if (!sauceCategory) {
    console.log("Could not find the sauce category.");
    process.exit(1);
  }

  console.log(`Sauce category identified as: "${sauceCategory}"`);

  let updatedCount = 0;
  for (const docSnap of itemSnap.docs) {
    const data = docSnap.data();
    if (data.category === sauceCategory) {
      const title = data.title;
      const lowerTitle = title.toLowerCase();
      
      // Check if it doesn't have "cup" and doesn't have "box"
      if (!lowerTitle.includes('cup') && !lowerTitle.includes('box')) {
        // Add " Cup" to the end
        const newTitle = title.trim() + " Cup";
        await updateDoc(doc(db, 'menuItems', docSnap.id), { title: newTitle });
        console.log(`Updated: '${title}' -> '${newTitle}'`);
        updatedCount++;
      }
    }
  }
  
  console.log(`Finished updating ${updatedCount} items.`);
  process.exit(0);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
