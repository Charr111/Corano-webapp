import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';

const Home = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-[100svh] w-full overflow-y-auto hide-scrollbar flex flex-col">
      {/* Hero Section */}
      <section className="relative flex-grow flex flex-col items-center justify-between pb-[calc(5rem+env(safe-area-inset-bottom))] pt-6 md:pt-16 lg:pt-2 shadow-2xl">
        <div className="absolute inset-0 z-0">
          <img
            src="https://images.restocorano.com/items/site-hero-chicken.jpg"
            alt="Delicious roasted chicken"
            className="w-full h-full object-cover"
            fetchPriority="high"
            loading="eager"
          />
          <div className="absolute inset-0 bg-black/60"></div>
        </div>
        
        {/* Top Logo */}
        <div className="relative z-10 w-full flex justify-center px-4">
          <img src="https://images.restocorano.com/items/corano-logo-full.png" alt="Corano Logo" className="h-[18vh] min-h-[100px] max-h-32 md:h-64 lg:h-52 w-auto object-contain drop-shadow-xl -ml-6 md:-ml-8" fetchPriority="high" loading="eager" />
        </div>
        
        {/* Main Content */}
        <div className="relative z-10 w-full px-6 flex flex-col items-center mt-auto mb-14 sm:mb-16 md:mb-24 lg:mb-8 lg:mt-0">
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-primary tracking-[0.3em] text-sm md:text-base uppercase mb-3 lg:mb-2 font-semibold"
          >
            EST. 2004
          </motion.div>
          
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1 }}
            className="font-headline text-5xl md:text-7xl text-white mb-1 lg:-mb-1 drop-shadow-lg"
          >
            The Primal
          </motion.h1>
          
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="font-headline text-5xl md:text-7xl text-primary italic mb-4 lg:mb-3 drop-shadow-lg"
          >
            Art of Fire.
          </motion.h1>
          
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="font-headline font-bold text-white/95 text-center text-lg md:text-xl lg:text-lg leading-relaxed mb-6 lg:mb-5 max-w-md md:max-w-xl"
          >
            Experience the true taste of charcoal grilling. At Corano, every single bite feels like home...made with passion, fire, and flavor.
          </motion.p>
          
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="w-full max-w-sm space-y-3 md:space-y-4 lg:space-y-3"
          >
            <button 
              onClick={() => navigate('/menu')}
              className="w-full bg-[#E4CD86] text-black font-normal font-['Anton'] text-[17px] py-3.5 md:py-4 lg:py-3 rounded-xl tracking-widest shadow-lg hover:bg-[#E4CD86]/90 transition-transform active:scale-95"
            >
              MENU
            </button>
            <button 
              onClick={() => navigate('/about')}
              className="w-full bg-[#E4CD86] text-black font-normal font-['Anton'] text-[16px] py-3.5 md:py-4 lg:py-3 rounded-xl tracking-widest shadow-lg hover:bg-[#E4CD86]/90 transition-transform active:scale-95"
            >
              VISIT US
            </button>
            <button 
              onClick={() => window.location.href = 'tel:+9613220810'}
              className="w-full bg-[#E4CD86] text-black font-normal font-['Anton'] text-[17px] py-3.5 md:py-4 lg:py-3 rounded-xl tracking-widest shadow-lg hover:bg-[#E4CD86]/90 transition-transform active:scale-95"
            >
              CONTACT US
            </button>
          </motion.div>
        </div>
        
      </section>
    </div>
  );
};

export default Home;
