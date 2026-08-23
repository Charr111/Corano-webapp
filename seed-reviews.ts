import { collection, addDoc } from 'firebase/firestore';
import { db } from './src/firebase.ts';

const reviewsToAdd = [
  {
    author: "Rima issa",
    text: "It was my first time at the new location and it is been maybe two years since i had my last chicken corano sandwich. It was amazing, maybe better. This sandwich is highly recommended. The new place is way much better than the old one. The staff is friendly and welcoming, you feel at home. One thing, the order took around 20 minutes, except of that all is good. I saw the cutest cat outside the restaurant.",
    rating: 5,
    status: 'approved',
    date: new Date().toLocaleDateString()
  },
  {
    author: "Eli Doueri",
    text: "Second time hitting up this spot—locals sent me here like it was a hidden gem, and turns out, they knew what they were talking about. It’s a good, honest, family-run place, and you can feel they actually care about their customers—not just serving food, but serving it right.\nI tried the chicken sandwiches and the burgers. Verdict? Solid.Nothing fancy, just real, tasty food done properly.\nDefinitely worth checking out. Good people, good food, no regrets.",
    rating: 5,
    status: 'approved',
    date: new Date().toLocaleDateString()
  },
  {
    author: "Carlos Bejjani",
    text: "Very friendly team, good food, best prices",
    rating: 5,
    status: 'approved',
    date: new Date().toLocaleDateString()
  },
  {
    author: "Jason Debs",
    text: "Great tasty experience. I had a douzen of Falafel they were huge and crunchy + 1 taouk sandwich . You must try this place once you're around Byblos.",
    rating: 5,
    status: 'approved',
    date: new Date().toLocaleDateString()
  },
  {
    author: "Dr. Roger Achkar",
    text: "A bit loud atmosphere but delicious sandwiches, especially the crunchy chicken.",
    rating: 5,
    status: 'approved',
    date: new Date().toLocaleDateString()
  },
  {
    author: "Tarek el hachem",
    text: "Best tawouk",
    rating: 5,
    status: 'approved',
    date: new Date().toLocaleDateString()
  },
  {
    author: "المهندس محمد السيد",
    text: "Corano is a name with a history",
    rating: 5,
    status: 'approved',
    date: new Date().toLocaleDateString()
  },
  {
    author: "Aggy",
    text: "It feels like home!",
    rating: 5,
    status: 'approved',
    date: new Date().toLocaleDateString()
  },
  {
    author: "Antoine El-khoury",
    text: "Family management, considerate and cosy",
    rating: 5,
    status: 'approved',
    date: new Date().toLocaleDateString()
  }
];

async function run() {
  for (const review of reviewsToAdd) {
    await addDoc(collection(db, 'reviews'), review);
    console.log(`Added review for ${review.author}`);
  }
  process.exit(0);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
