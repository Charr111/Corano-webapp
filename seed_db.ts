import { collection, getDocs, deleteDoc, doc, addDoc } from 'firebase/firestore';
import { db } from './src/firebase';
import fs from 'fs';

async function run() {
  console.log("Reading data...");
  const data = JSON.parse(fs.readFileSync('menu_data.json', 'utf-8'));
  
  console.log("Clearing old items...");
  const oldItems = await getDocs(collection(db, 'menuItems'));
  for (const item of oldItems.docs) {
    await deleteDoc(doc(db, 'menuItems', item.id));
  }

  console.log("Clearing old categories...");
  const oldCats = await getDocs(collection(db, 'menuCategories'));
  for (const cat of oldCats.docs) {
    await deleteDoc(doc(db, 'menuCategories', cat.id));
  }

  console.log("Inserting new categories...");
  for (const cat of data.categories) {
    await addDoc(collection(db, 'menuCategories'), cat);
  }

  console.log("Inserting new items...");
  for (const item of data.items) {
    await addDoc(collection(db, 'menuItems'), item);
  }

  console.log("Done!");
}

run().catch(console.error);
