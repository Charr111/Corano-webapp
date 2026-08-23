import { collection, getDocs } from 'firebase/firestore';
import { db } from './src/firebase.ts';

async function run() {
  const itemSnap = await getDocs(collection(db, 'menuItems'));
  const allItems: string[] = [];
  
  for (const docSnap of itemSnap.docs) {
    const data = docSnap.data();
    allItems.push(data.title);
  }
  
  console.log("--- ALL ITEMS ---");
  allItems.forEach(i => console.log(i));
  process.exit(0);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
