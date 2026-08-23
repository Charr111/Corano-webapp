import fs from 'fs';

const RATE = 89000;
function toUSD(ll) {
  return (ll / RATE).toFixed(2);
}

const formatCombo = () => {
  return `Make it combo (Fries & Drink) $${toUSD(250000)}`;
};

const formatAddons = () => {
  return [
    `Add shich lahme $${toUSD(350000)}`,
    `Add Shish Tawook $${toUSD(300000)}`,
    `Add Shish Kafta $${toUSD(300000)}`,
    `Add shish Kabab $${toUSD(300000)}`,
  ];
};

const items = [
  // Subs
  { cat: 'subs', title: 'Chicken Corano', desc: 'Chicken breast, cheese, onions, sweet pepper, special sauce.', price: 700000 },
  { cat: 'subs', title: 'Famous Crispy Barbecue', desc: 'Crispy chicken, lettuce, pickles, mixed cheese, chips, bbq and honey mustard sauce.', price: 700000 },
  { cat: 'subs', title: 'Chicken Salameh Thierry', desc: 'Marinated chicken breast, fries, salameh, cheese, and honey mustard.', price: 700000 },
  { cat: 'subs', title: 'Chicken Sub', desc: 'Chicken breast, lettuce, tomato, pickles, Mixed cheese, aioli sauce.', price: 700000 },
  { cat: 'subs', title: 'Sub Marine', desc: 'Ham salameh, mixed cheese, lettuce, tomato, pickles, corn, and mayo sauce', price: 650000 },
  { cat: 'subs', title: 'Tandory', desc: 'Marinated chicken breast, lettuce, tomato, pickles, mixed cheese and our speciale sauce', price: 700000 },
  { cat: 'subs', title: 'Chicken BBQ', desc: 'Chicken breast, onion, cheese, lettuce, pickles, BBQ sauce, and mayo sauce.', price: 700000 },
  { cat: 'subs', title: 'Chicken Avocado (BROWN BREAD 24cm)', desc: 'Grilled chicken, lettuce, pickles, avocado slice, honey mustard sauce.', price: 650000 },
  { cat: 'subs', title: 'Crab (BROWN BREAD 24cm)', desc: 'Crab sticks, lettuce, avocado, carrot, cocktail sauce.', price: 550000 },
  { cat: 'subs', title: 'Tuna', desc: 'White tuna, coleslaw, pickles, corn, and lemon mustard sauce.', price: 500000 },
  { cat: 'subs', title: 'Chicken Breast Light (BROWN BREAD)', desc: 'Chicken breast, iceburg, pickles, tomato, garlic, and light mayo.', price: 600000 },
  { cat: 'subs', title: 'Steak sub', desc: 'Beef steak lettuce corn cheese and steak sauce', price: 750000 },
  { cat: 'subs', title: 'Steak sandwich light', desc: 'Steak, brown baguette, rocca, tomato and mayo light', price: 700000 },
  { cat: 'subs', title: 'Phileadephia (Beef)', desc: 'Beef, onion, mushroom, cheese, green pepper, mayo', price: 750000 },
  { cat: 'subs', title: 'Crispy sub', desc: 'Chicken crispy, lettuce, pickles, fries, cocktail sauce.', price: 650000 },
  { cat: 'subs', title: 'Ham and cheese', desc: '', price: 450000 },
  { cat: 'subs', title: 'Djeij aal fahem Bl sub', desc: '', price: 600000 },
  { cat: 'subs', title: 'Tweety', desc: 'Grilled chicken breast coleslaw pickles fries cheese and honey mustard sauce', price: 700000 },
  { cat: 'subs', title: 'Chicken honey mustard', desc: 'Crispy chicken, cheddar cheese, chips, lettuce, pickles, honey mustard sauce', price: 700000 },

  // Burgers
  { cat: 'burgers', title: 'Lebanese Burger', desc: 'Beef patty, coleslaw, fries, ketchup', price: 500000 },
  { cat: 'burgers', title: 'Add Cheese', desc: '', price: 150000 },
  { cat: 'burgers', title: 'Classic Burger', desc: 'Beef patty, grilled onions, lettuce, tomatoes, cocktail sauce and pickles.', price: 500000 },
  { cat: 'burgers', title: 'Crispy cheddar Burger', desc: 'Crispy fried chicken, cheddar cheese, chips, lettuce, pickles and garlic mayo sauce', price: 600000 },
  { cat: 'burgers', title: 'Mozzarella Pane', desc: 'Breaded mozzarella, lettuce, pickles, tomato and cocktail sauce', price: 450000 },
  { cat: 'burgers', title: 'Cheddar Pane Burger', desc: 'Beef meat, cheddar pane, lettuce, pickles, chips fries, chedder sauce, And our special sauce.', price: 650000 },
  { cat: 'burgers', title: 'BBQ Burger', desc: 'Beef patty or grilled chicken breast, lettuce, pickles, cheddar cheese, bacon, grilled onions with BBQ mayo sauce', price: 600000 },
  { cat: 'burgers', title: 'Cheddar Cheese Burger', desc: 'Beef patty, cheddar, lettuce, grilled onions, tomato pickles and our special sauce', price: 600000 },
  { cat: 'burgers', title: 'Chicken breast Burger', desc: '', price: 500000 },
  { cat: 'burgers', title: 'Cheese burger', desc: 'Coleslaw fries ketchup and mozzarella cheese', price: 600000 },

  // Mashewe
  { cat: 'mashewe', title: 'Barbecue chicken whole ( farouj) Dine In', desc: 'Garlic and pickels', price: 1400000 },
  { cat: 'mashewe', title: 'Barbecue chicken whole ( farouj) delivery', desc: 'Garlic and pickels', price: 1200000 },
  { cat: 'mashewe', title: 'Barbecue Half Chicken Dine In', desc: '', price: 900000 },
  { cat: 'mashewe', title: 'Barbecue Half Chicken', desc: 'Pickels garlic and fries', price: 800000 },
  { cat: 'mashewe', title: 'Tawouk 3al fahem', desc: 'Fries, pickles, colslaw, garlic, and tomato', price: 1100000 },
  { cat: 'mashewe', title: 'Kafta', desc: '4 chich kafta, Hummus, biwas, tomato, pickles, and fries', price: 1250000 },
  { cat: 'mashewe', title: 'Kabab', desc: '4 chich kabab, Hummus, biwas, tomato, pickles, and fries', price: 1250000 },
  { cat: 'mashewe', title: 'Mixed Grilled', desc: '2 shish kafta, 1 shish kabab, 1 shish, taouk, Homos, Biwas, Pickles, Grilled Tomato, French fries, Garlic, Grilled green pepper.', price: 1350000 },
  { cat: 'mashewe', title: 'Mix Grilled 1 kg', desc: 'Kafta+ kabab+ tawook + garlic + pickles+hommos', price: 2850000 },
  { cat: 'mashewe', title: 'Grilled chicken breast (1 piece)', desc: 'Grilled chicken breast, garlic, pickles, fries', price: 650000 },
  { cat: 'mashewe', title: 'Grilled chicken breast (2 pieces)', desc: 'Grilled chicken breast, garlic, pickles, fries', price: 1100000 },
  { cat: 'mashewe', title: 'Lahme platter', desc: '4 skewers, hummus, grilled onion and tomato, biwas, pickles, fries.', price: 1400000 },
  { cat: 'mashewe', title: '1KG Lahme Ghanam', desc: '', price: 3500000 },
  { cat: 'mashewe', title: '1kg tawouk', desc: '', price: 2250000 },
  { cat: 'mashewe', title: '1kg kabab', desc: '', price: 2850000 },
  { cat: 'mashewe', title: '1kg kafta', desc: '', price: 2850000 },
  { cat: 'mashewe', title: 'Mixed Grill extra', desc: '1 kafta, 1 lahme, 1 kabab, 1 tawouk, humus garlic, grilled onion, fries', price: 1450000 },
  { cat: 'mashewe', title: '1/2 kg kafta', desc: '', price: 1500000 },
  { cat: 'mashewe', title: '1/2 kg kabab', desc: '', price: 1500000 },
  { cat: 'mashewe', title: '1/2 kg lahme', desc: '', price: 2000000 },
  { cat: 'mashewe', title: '1/2 kg tawouk', desc: '', price: 1350000 },
  { cat: 'mashewe', title: '1kg Mixed Grill Extra', desc: '', price: 3200000 },
  { cat: 'mashewe', title: 'Plate sawda mechwe', desc: '2 chich sawda garlic pickles fries', price: 1000000 },
  { cat: 'mashewe', title: 'Half kilo mixed grilled extra', desc: '', price: 1800000 },
];

function capitalizeFirst(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

const processedItems = items.map(item => {
  let addons = [];
  
  if (['subs', 'burgers'].includes(item.cat)) {
    if (item.title.toLowerCase() !== 'add cheese') {
      addons.push(formatCombo());
    }
  }

  const titleLower = item.title.toLowerCase();
  if (
    titleLower === 'mixed grilled' ||
    titleLower === 'mix grilled 1 kg' ||
    titleLower === 'mixed grill extra' ||
    titleLower === '1kg mixed grill extra'
  ) {
    addons = addons.concat(formatAddons());
  }

  return {
    category: item.cat,
    title: capitalizeFirst(item.title),
    price: toUSD(item.price),
    desc: capitalizeFirst(item.desc),
    img: '', // leaving empty for now
    available: true,
    ...(addons.length > 0 ? { addons } : {})
  };
});

const cats = [
  { name: 'Subs', order: 1 },
  { name: 'Burgers', order: 2 },
  { name: 'Mashewe', order: 3 },
];

fs.writeFileSync('menu_data.json', JSON.stringify({ categories: cats, items: processedItems }, null, 2));
