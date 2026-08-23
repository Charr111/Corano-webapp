import fs from 'fs';

console.log('Reviews:', fs.readFileSync('src/pages/Reviews.tsx', 'utf8').match(/res\.cloudinary\.com.*\.jpg/)[0]);
console.log('Visit:', fs.readFileSync('src/pages/Visit.tsx', 'utf8').match(/res\.cloudinary\.com.*\.jpg/)[0]);
console.log('Home (Story):', fs.readFileSync('src/pages/Home.tsx', 'utf8').match(/res\.cloudinary\.com.*our-story\.jpg/)[0]);
console.log('Home (Logo):', fs.readFileSync('src/pages/Home.tsx', 'utf8').match(/res\.cloudinary\.com.*corano-logo/)[0]);
