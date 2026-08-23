import fs from 'fs';
let html = fs.readFileSync('index.html', 'utf8');

if (!html.includes('preconnect')) {
  html = html.replace(
    '<link href="https://fonts.googleapis.com/css2?', 
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n    <link href="https://fonts.googleapis.com/css2?'
  );
  fs.writeFileSync('index.html', html);
}
