import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './src/firebase.js';

async function run() {
  const q = query(collection(db, 'menuItems'), where('category', 'in', ['sandwiches', 'salads', 'Sandwiches', 'Salads']));
  const itemSnap = await getDocs(q);
  const items = itemSnap.docs.map(d => d.data());
  console.log(JSON.stringify(items, null, 2));
}

run().catch(console.error);
