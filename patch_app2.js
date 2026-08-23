import fs from 'fs';
let code = fs.readFileSync('src/App.tsx', 'utf8');

// replace the App function
const appCode = `
const MainLayout = () => {
  const location = useLocation();
  const isHome = location.pathname === '/' || location.pathname === '/home';
  return (
    <>
      <Header />
      <main className={\`flex-grow pb-16 \${isHome ? 'pt-0' : 'pt-24'}\`}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/home" element={<Home />} />
          <Route path="/menu" element={<Menu />} />
          <Route path="/visit" element={<Visit />} />
          <Route path="/reviews" element={<Reviews />} />
          <Route path="/admin" element={<Admin />} />
        </Routes>
      </main>
      <BottomNav />
    </>
  );
};

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-background text-on-background flex flex-col">
        <MainLayout />
      </div>
    </BrowserRouter>
  );
}
export default App;
`;

code = code.replace(/function App\(\) \{[\s\S]*export default App;/m, appCode);
fs.writeFileSync('src/App.tsx', code);
