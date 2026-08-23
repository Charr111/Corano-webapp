import { collection, getDocs, updateDoc, doc } from 'firebase/firestore';
import { db } from './src/firebase.ts';
async function run() {
  const snap = await getDocs(collection(db, 'reviews'));
  for (const d of snap.docs) {
    if (!d.data().status) {
      await updateDoc(doc(db, 'reviews', d.id), { status: 'approved' });
      console.log('Fixed review', d.id);
    }
  }
  process.exit(0);
}
run();
