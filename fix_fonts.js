import fs from 'fs';
let html = fs.readFileSync('index.html', 'utf8');
html = html.replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]+>/, '<link href="https://fonts.googleapis.com/css2?family=Anton&family=Manrope:wght@300;400;500;600;700;800&family=Noto+Serif:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet"/>');
fs.writeFileSync('index.html', html);
