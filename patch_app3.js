import fs from 'fs';
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
  /className="fixed top-0 w-full bg-surface\/90 backdrop-blur-md z-50 h-24 flex items-center justify-center"/,
  'className="absolute top-0 w-full z-50 h-28 flex items-center justify-center pointer-events-none"'
);

code = code.replace(
  /className="flex items-center justify-center"/,
  'className="flex items-center justify-center pointer-events-auto drop-shadow-2xl"'
);

code = code.replace(
  /<main className=\{\`flex-grow pb-16 \$\{isHome \? 'pt-0' : 'pt-24'\}\`\}>/,
  '<main className={`flex-grow pb-16 ${isHome ? \'pt-0\' : \'pt-28\'}`}>'
);

fs.writeFileSync('src/App.tsx', code);
