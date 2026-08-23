import fs from 'fs';
let code = fs.readFileSync('src/App.tsx', 'utf8');

// Remove DesktopNav
code = code.replace(/const DesktopNav = \(\) => \{[\s\S]*?\};\n/m, '');
code = code.replace(/<DesktopNav \/>\n?\s*/, '');

// Fix MobileHeader to Header, make it visible on all screens
code = code.replace(/const MobileHeader =/g, 'const Header =');
code = code.replace(/<MobileHeader \/>/g, '<Header />');
code = code.replace(/<div className="md:hidden fixed/g, '<div className="fixed');

// Fix BottomNav to be visible on all screens
code = code.replace(/<nav className="md:hidden fixed bottom-0/g, '<nav className="fixed bottom-0');

// Main padding
code = code.replace(/<main className="flex-grow pt-0 md:pt-24 pb-16 md:pb-0">/, '<main className="flex-grow pt-0 pt-24 pb-16">');

fs.writeFileSync('src/App.tsx', code);
