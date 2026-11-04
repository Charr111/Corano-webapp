import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where } from 'firebase/firestore';

const firebaseConfig = {
  projectId: "gen-lang-client-0695564898",
  appId: "1:231556278451:web:36a9bf29f748dcbe2b28c6",
  apiKey: "AIzaSyAH-eDqMz_Zlp93Ghgg72o7U6BN6QfxbRs",
  authDomain: "gen-lang-client-0695564898.firebaseapp.com"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, "ai-studio-coranomenuwebsit-a4ab4937-8d7d-4d14-894a-7256d8c96b7e");

async function run() {
  const items = await getDocs(collection(db, 'menuItems'));
  items.forEach(d => {
    if (d.data().title === 'Ham and cheese' || d.data().title === 'Truffle Burger' || d.data().title === 'Light Chicken') {
      console.log(d.id, d.data());
    }
  });
  process.exit(0);
}
run();
