import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import Home from './pages/Home';
import Menu from './pages/Menu';
import About from './pages/About';
import Reviews from './pages/Reviews';
import PageMeta from './components/PageMeta';
import CoranoAiWidget from './components/CoranoAiWidget';
import PromoBannerModal from './components/PromoBannerModal';

const Admin = lazy(() => import('./pages/Admin'));


const Header = () => {
  const location = useLocation();
  // Don't show header on home page or admin dashboard
  if (location.pathname === '/home' || location.pathname === '/' || location.pathname.startsWith('/admin')) return null;
  
  return (
    <div className="fixed top-0 left-0 right-0 w-full z-50 h-28 flex items-center justify-center pointer-events-none bg-background/95 backdrop-blur-md border-b border-outline-variant/20">
      <Link to="/home" className="flex items-center justify-center pointer-events-auto drop-shadow-2xl">
        <img src="https://images.restocorano.com/items/corano-logo-header.png" alt="Corano Logo" className="h-20 w-auto object-contain" fetchPriority="high" loading="eager" />
      </Link>
    </div>
  );
};

const BottomNav = () => {
  const location = useLocation();
  if (location.pathname.startsWith('/admin')) return null;

  const isHome = location.pathname === '/' || location.pathname === '/home';
  const isMenu = location.pathname.startsWith('/menu');
  const isAbout = location.pathname.startsWith('/about');
  const isReviews = location.pathname.startsWith('/reviews');

  return (
    <nav className="fixed bottom-0 left-0 right-0 w-full bg-surface/95 backdrop-blur-md border-t border-outline-variant/20 z-50 pb-[env(safe-area-inset-bottom)]">
      <div className="flex justify-around items-center h-16">
        <Link to="/home" className={`flex flex-col items-center justify-center w-full h-full ${isHome ? 'text-primary' : 'text-on-surface-variant'}`}>
          <svg className="w-6 h-6 fill-current shrink-0" viewBox="0 -960 960 960" aria-hidden="true">
            <path d="M260-220h150v-250h140v250h150v-390L480-776 260-610v390Zm-60 60v-480l280-210 280 210v480H530v-250H430v250H200Zm280-353Z" />
          </svg>
          <span className="font-headline text-[10px] font-medium mt-1">Home</span>
        </Link>
        <Link to="/menu" className={`flex flex-col items-center justify-center w-full h-full ${isMenu ? 'text-primary' : 'text-on-surface-variant'}`}>
          <svg className="w-6 h-6 fill-current shrink-0" viewBox="0 -960 960 960" aria-hidden="true">
            <path d="M292-120v-334q-50-11-83-52t-33-98v-236h60v236q0 28 19 47t47 19q28 0 47-19t19-47v-236h60v236q0 57-33 98t-83 52v334h-60Zm364 0v-320H548v-284q0-69 48.5-112.5T716-880v760h-60Z" />
          </svg>
          <span className="font-headline text-[10px] font-medium mt-1">Menu</span>
        </Link>
        <Link to="/about" className={`flex flex-col items-center justify-center w-full h-full ${isAbout ? 'text-primary' : 'text-on-surface-variant'}`}>
          <svg className="w-6 h-6 fill-current shrink-0" viewBox="0 -960 960 960" aria-hidden="true">
            <path d="M182-800v-60h596v60H182Zm6 640v-254h-48v-60l42-186h596l42 186v60h-48v254h-60v-254H542v254H188Zm60-60h234v-194H248v194Zm-45-254h554-554Zm0 0h554l-28-126H231l-28 126Z" />
          </svg>
          <span className="font-headline text-[10px] font-medium mt-1">About</span>
        </Link>
        <Link to="/reviews" className={`flex flex-col items-center justify-center w-full h-full ${isReviews ? 'text-primary' : 'text-on-surface-variant'}`}>
          <svg className="w-6 h-6 fill-current shrink-0" viewBox="0 -960 960 960" aria-hidden="true">
            <path d="m354-287 126-76 126 77-33-144 111-96-146-13-58-136-58 135-146 13 111 97-33 143ZM233-120l65-281L80-590l288-25 112-265 112 265 288 25-218 189 65 281-247-149-247 149Zm247-350Z" />
          </svg>
          <span className="font-headline text-[10px] font-medium mt-1">Reviews</span>
        </Link>
      </div>
    </nav>
  );
};

const MainLayout = () => {
  const location = useLocation();
  const isFullBleed = location.pathname === '/' || location.pathname === '/home' || location.pathname.startsWith('/admin');

  return (
    <>
      <PageMeta /><Header />
      <main className={`flex-grow relative ${isFullBleed ? 'pt-0' : 'pt-28 pb-16'}`}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/home" element={<Home />} />
          <Route path="/menu" element={<Menu />} />
          <Route path="/menu/:categorySlug" element={<Menu />} />
          <Route path="/menu/:categorySlug/:itemSlug" element={<Menu />} />
          <Route path="/about" element={<About />} />
          <Route path="/reviews" element={<Reviews />} />
          <Route
            path="/admin"
            element={
              <Suspense fallback={<div className="min-h-[100dvh] bg-background" />}>
                <Admin />
              </Suspense>
            }
          />
        </Routes>
      </main>
      <PromoBannerModal />
      <CoranoAiWidget />
      <BottomNav />
    </>
  );
};

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-[100dvh] bg-background text-on-background flex flex-col">
        <MainLayout />
      </div>
    </BrowserRouter>
  );
}
export default App;

