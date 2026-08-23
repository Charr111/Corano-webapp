import { collection, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { db } from './src/firebase.ts';

async function run() {
  const reviewsSnap = await getDocs(collection(db, 'reviews'));
  console.log("--- REVIEWS ---");
  for (const r of reviewsSnap.docs) {
    console.log(r.id, "=>", r.data().author, "-", r.data().text);
  }
  process.exit(0);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
