import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import Home from './pages/Home';
import Menu from './pages/Menu';
import Visit from './pages/Visit';
import Reviews from './pages/Reviews';
import Admin from './pages/Admin';
import PageMeta from './components/PageMeta';


const Header = () => {
  const location = useLocation();
  // Don't show header on home page because the hero section has the logo
  if (location.pathname === '/home' || location.pathname === '/') return null;
  
  return (
    <div className="fixed top-0 left-0 right-0 w-full z-50 h-28 flex items-center justify-center pointer-events-none bg-background/95 backdrop-blur-md border-b border-outline-variant/20">
       <Link to="/home" className="flex items-center justify-center pointer-events-auto drop-shadow-2xl">
        <img src="https://res.cloudinary.com/wlgd4zum/image/upload/f_auto,q_auto,w_600/corano-logo" alt="Corano Logo" className="h-20 w-auto object-contain" fetchPriority="high" loading="eager" />
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
          <span className="text-[10px] font-medium mt-1">Home</span>
        </Link>
        <Link to="/menu" className={`flex flex-col items-center justify-center w-full h-full ${currentView === 'menu' ? 'text-primary' : 'text-on-surface-variant'}`}>
          <span className="material-symbols-outlined text-2xl">restaurant_menu</span>
          <span className="text-[10px] font-medium mt-1">Menu</span>
        </Link>
        <Link to="/visit" className={`flex flex-col items-center justify-center w-full h-full ${currentView === 'visit' ? 'text-primary' : 'text-on-surface-variant'}`}>
          <span className="material-symbols-outlined text-2xl">storefront</span>
          <span className="text-[10px] font-medium mt-1">Visit</span>
        </Link>
        <Link to="/reviews" className={`flex flex-col items-center justify-center w-full h-full ${currentView === 'reviews' ? 'text-primary' : 'text-on-surface-variant'}`}>
          <span className="material-symbols-outlined text-2xl">star</span>
          <span className="text-[10px] font-medium mt-1">Reviews</span>
        </Link>
      </div>
    </nav>
  );
};

const MainLayout = () => {
  const location = useLocation();
  const isHome = location.pathname === '/' || location.pathname === '/home';

  return (
    <>
      <PageMeta /><Header />
      <main className={`flex-grow relative ${isHome ? 'pt-0' : 'pt-28 pb-16'}`}>
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
      <div className="min-h-[100dvh] bg-background text-on-background flex flex-col">
        <MainLayout />
      </div>
    </BrowserRouter>
  );
}
export default App;

