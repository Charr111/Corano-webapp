import { collection, getDocs, updateDoc, doc, setDoc, addDoc } from 'firebase/firestore';
import { db } from './src/firebase.ts';

function formatUrl(originalUrl: string, name: string): string {
  if (!originalUrl.includes('/upload/')) return originalUrl;
  const parts = originalUrl.split('/upload/');
  const safeName = encodeURIComponent(name.replace(/ /g, '_'));
  return `${parts[0]}/upload/f_auto,q_auto,w_600,c_limit/${parts[1]}?item=${safeName}`;
}

const updates: Record<string, string> = {
  "Pizza pepperoni": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786885120/a9177066-0f98-4912-9fd0-ee4c9d0128b2.jpg",
  "Lebanese pizza (30cm)": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786885120/a9177066-0f98-4912-9fd0-ee4c9d0128b2.jpg",
  "Dozen Falafel with tarator": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786632132/121cc938-a72d-4b15-aceb-d87044d14ed3.jpg",
  "Sandwich Falafel Extra": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786632132/121cc938-a72d-4b15-aceb-d87044d14ed3.jpg",
  "Sandwich Falafel": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786632132/121cc938-a72d-4b15-aceb-d87044d14ed3.jpg",
  "Dozen Falafel extra": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786632904/0e960cfa-584c-484a-ba65-e427f82b185b.jpg",
  "Dozen Falafel": "https://res.cloudinary.com/wlgd4zum/image/upload/v1786632904/0e960cfa-584c-484a-ba65-e427f82b185b.jpg"
};

const rate = 89000;

const newDrinks = [
  { name: "Pepsi Reg./Diet/Zero", priceLL: 100000, img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1786897730/81108ede0fac198b78850fea88a05061.webp" },
  { name: "7up Reg./Diet", priceLL: 100000, img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1786897822/13213_main.jpg" },
  { name: "Miranda", priceLL: 100000, img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1786898104/image88s.jpg" },
  { name: "Miranda 1.25L", priceLL: 200000, img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1786898190/images_1.jpg" },
  { name: "H2o lemon", priceLL: 100000, img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1786898357/13232_main.avif" },
  { name: "H2O orange", priceLL: 100000, img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1786898315/13231_main.avif" },
  { name: "Pepsi Reg./Diet/Zero 1.25", priceLL: 150000, img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1786898195/images_2.jpg" },
  { name: "7up Reg./Diet  1.25 l", priceLL: 200000, img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1786898307/images_3.jpg" },
  { name: "Perrier", priceLL: 150000, img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1786898520/110811-v001-1_1.jpg" },
  { name: "Mexican beer", priceLL: 300000, img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1786898812/images_8.jpg" },
  { name: "Fresh orange juice", priceLL: 200000, img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1786898825/images_9.jpg" },
  { name: "BEER", priceLL: 200000, img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1786898775/images_7.jpg" },
  { name: "WATER SMALL", priceLL: 50000, img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1786898667/16981499261.jpg" },
  { name: "Water Large", priceLL: 100000, img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1786898678/images_6.jpg" },
  { name: "Laban ayran", priceLL: 130000, img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1786898614/images_5.jpg" },
  { name: "Ice Tea Peach Reg./Diet", priceLL: 150000, img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1786898584/images_4.jpg" }
];

const newHotDrinks = [
  { name: "Espresso", priceLL: 75000, img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1786899022/images_10.jpg" },
  { name: "Nescafe 3in1", priceLL: 100000, img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1786899003/images_11.jpg" },
  { name: "Cafe Mocha", priceLL: 150000, img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1786898989/images_12.jpg" },
  { name: "Cappucino", priceLL: 150000, img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1786898975/images_13.jpg" },
  { name: "Hot Chocolate", priceLL: 150000, img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1786898969/images_14.jpg" },
  { name: "Cafe late 2in1", priceLL: 150000, img: "https://res.cloudinary.com/wlgd4zum/image/upload/v1786899003/images_11.jpg" }
];

async function ensureCategory(id: string, name: string, order: number) {
  const catsSnap = await getDocs(collection(db, 'menuCategories'));
  let exists = false;
  catsSnap.forEach(d => { if (d.id === id || d.data().name.toLowerCase() === name.toLowerCase()) exists = true; });
  if (!exists) {
    await setDoc(doc(db, 'menuCategories', id), { name, order });
    console.log(`Added missing category: ${name}`);
  }
}

async function run() {
  await ensureCategory('drinks', 'Drinks', 20);
  await ensureCategory('hotDrinks', 'Hot Drinks', 21);

  const itemSnap = await getDocs(collection(db, 'menuItems'));
  let updatedCount = 0;
  const existingItems = new Set();
  
  for (const docSnap of itemSnap.docs) {
    const data = docSnap.data();
    existingItems.add(data.title);
    
    if (updates[data.title]) {
      const newUrl = formatUrl(updates[data.title], data.title);
      await updateDoc(doc(db, 'menuItems', docSnap.id), { img: newUrl });
      console.log(`Updated: ${data.title} -> ${newUrl}`);
      updatedCount++;
    }
  }

  let order = 10;
  let addedDrinksCount = 0;
  for (const drink of newDrinks) {
    if (existingItems.has(drink.name)) continue;
    const priceUsd = (drink.priceLL / rate).toFixed(2);
    const imgUrl = formatUrl(drink.img, drink.name);
    await addDoc(collection(db, 'menuItems'), {
      title: drink.name,
      category: 'drinks',
      price: priceUsd,
      desc: "",
      img: imgUrl,
      available: true,
      order: order
    });
    console.log(`Added Drink: ${drink.name} at $${priceUsd}`);
    order += 10;
    addedDrinksCount++;
  }

  order = 10;
  let addedHotDrinksCount = 0;
  for (const drink of newHotDrinks) {
    if (existingItems.has(drink.name)) continue;
    const priceUsd = (drink.priceLL / rate).toFixed(2);
    const imgUrl = formatUrl(drink.img, drink.name);
    await addDoc(collection(db, 'menuItems'), {
      title: drink.name,
      category: 'hot drinks',
      price: priceUsd,
      desc: "",
      img: imgUrl,
      available: true,
      order: order
    });
    console.log(`Added Hot Drink: ${drink.name} at $${priceUsd}`);
    order += 10;
    addedHotDrinksCount++;
  }

  console.log(`Finished updating ${updatedCount} items, added ${addedDrinksCount} drinks, added ${addedHotDrinksCount} hot drinks.`);
  process.exit(0);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
