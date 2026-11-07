import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import Home from './pages/Home';
import Menu from './pages/Menu';
import About from './pages/About';
import Reviews from './pages/Reviews';
import Admin from './pages/Admin';
import PageMeta from './components/PageMeta';
import CoranoAiWidget from './components/CoranoAiWidget';


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
  const currentView = location.pathname === '/' ? 'home' : location.pathname.substring(1);

  // Hide bottom nav on admin panel
  if (currentView === 'admin') return null;

  return (
    <nav className="fixed bottom-0 left-0 right-0 w-full bg-surface/95 backdrop-blur-md border-t border-outline-variant/20 z-50 pb-[env(safe-area-inset-bottom)]">
      <div className="flex justify-around items-center h-16">
        <Link to="/home" className={`flex flex-col items-center justify-center w-full h-full ${currentView === 'home' ? 'text-primary' : 'text-on-surface-variant'}`}>
          <span className="material-symbols-outlined text-2xl">home</span>
          <span className="font-headline text-[10px] font-medium mt-1">Home</span>
        </Link>
        <Link to="/menu" className={`flex flex-col items-center justify-center w-full h-full ${currentView === 'menu' ? 'text-primary' : 'text-on-surface-variant'}`}>
          <span className="material-symbols-outlined text-2xl">restaurant_menu</span>
          <span className="font-headline text-[10px] font-medium mt-1">Menu</span>
        </Link>
        <Link to="/about" className={`flex flex-col items-center justify-center w-full h-full ${currentView === 'about' ? 'text-primary' : 'text-on-surface-variant'}`}>
          <span className="material-symbols-outlined text-2xl">storefront</span>
          <span className="font-headline text-[10px] font-medium mt-1">About</span>
        </Link>
        <Link to="/reviews" className={`flex flex-col items-center justify-center w-full h-full ${currentView === 'reviews' ? 'text-primary' : 'text-on-surface-variant'}`}>
          <span className="material-symbols-outlined text-2xl">star</span>
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
          <Route path="/about" element={<About />} />
          <Route path="/reviews" element={<Reviews />} />
          <Route path="/admin" element={<Admin />} />
        </Routes>
      </main>
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

