import { collection, getDocs } from 'firebase/firestore';
import { db } from './src/firebase.ts';

async function run() {
  const itemSnap = await getDocs(collection(db, 'menuItems'));
  const items = itemSnap.docs.map(d => d.data());
  const sandwichesAndSalads = items.filter(i => i.category.toLowerCase() === 'sandwiches' || i.category.toLowerCase() === 'salads');
  
  console.log("Sandwiches:");
  sandwichesAndSalads.filter(i => i.category.toLowerCase() === 'sandwiches').forEach(i => console.log("- " + i.title));
  
  console.log("Salads:");
  sandwichesAndSalads.filter(i => i.category.toLowerCase() === 'salads').forEach(i => console.log("- " + i.title));
  
  process.exit(0);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
