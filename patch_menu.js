import fs from 'fs';
let code = fs.readFileSync('src/pages/Menu.tsx', 'utf8');

code = code.split('className="min-h-screen bg-background py-8 px-4 sm:px-6 lg:px-8 mt-14 md:mt-0"').join('className="relative min-h-screen py-8 px-4 sm:px-6 lg:px-8 mt-14 md:mt-0"');

const insertion = `
    >
      <div className="fixed inset-0 z-0 pointer-events-none">
        <img src="https://res.cloudinary.com/wlgd4zum/image/upload/f_auto,q_auto,w_1200/v1786475423/corano_673c67.jpg" alt="Menu Background" className="w-full h-full object-cover opacity-30" />
        <div className="absolute inset-0 bg-background/85"></div>
      </div>
      <div className="relative z-10 max-w-7xl mx-auto">
`.trim();

code = code.replace(/>\s*<div className="max-w-7xl mx-auto">/, `> ${insertion}`);
fs.writeFileSync('src/pages/Menu.tsx', code);
