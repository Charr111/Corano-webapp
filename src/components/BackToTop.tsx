import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';

const BackToTop = () => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const toggleVisibility = () => {
      // Appear after scrolling down a reasonable amount (~4 items worth of height)
      if (window.scrollY > 600) {
        setIsVisible(true);
      } else {
        setIsVisible(false);
      }
    };

    window.addEventListener('scroll', toggleVisibility);
    // Initial check in case the page loads already scrolled
    toggleVisibility();

    return () => window.removeEventListener('scroll', toggleVisibility);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.2 }}
          onClick={scrollToTop}
          // Placed cleanly above the Corano AI floating bubble on both mobile and desktop
          className="fixed bottom-40 md:bottom-40 right-4 md:right-6 z-[45] p-3.5 bg-[#E4CD86] text-black rounded-full shadow-2xl hover:bg-[#E4CD86]/90 transition-colors active:scale-95 flex items-center justify-center"
          aria-label="Back to top"
        >
          <svg className="w-6 h-6 fill-current shrink-0" viewBox="0 -960 960 960" aria-hidden="true">
            <path d="M440-160v-487L216-423l-56-57 320-320 320 320-56 57-224-224v487h-80Z" />
          </svg>
        </motion.button>
      )}
    </AnimatePresence>
  );
};

export default BackToTop;
