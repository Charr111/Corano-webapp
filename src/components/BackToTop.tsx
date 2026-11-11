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

    window.addEventListener('scroll', toggleVisibility, { passive: true });
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

  const isIosMobile =
    typeof navigator !== 'undefined' &&
    (/iPhone|iPod|iPad/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

  const isAndroidMobile =
    typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.2 }}
          onClick={scrollToTop}
          // Placed on the left side at the same size & bottom clearance as the AI Waiter circle
          className={`fixed ${
            isIosMobile
              ? 'bottom-[calc(5.35rem+env(safe-area-inset-bottom))] left-3'
              : 'bottom-[calc(4.35rem+env(safe-area-inset-bottom))] left-2.5'
          } sm:bottom-20 sm:left-6 z-[45] w-11 h-11 sm:w-13 sm:h-13 bg-[#E4CD86] text-black rounded-full shadow-2xl hover:bg-[#E4CD86]/90 transition-colors active:scale-95 flex items-center justify-center ${
            isAndroidMobile ? 'scale-[0.95] origin-bottom-left' : ''
          }`}
          aria-label="Back to top"
        >
          <svg
            className="w-[21px] h-[21px] sm:w-[25px] sm:h-[25px] fill-current shrink-0"
            viewBox="0 -960 960 960"
            aria-hidden="true"
          >
            <path d="M440-160v-487L216-423l-56-57 320-320 320 320-56 57-224-224v487h-80Z" />
          </svg>
        </motion.button>
      )}
    </AnimatePresence>
  );
};

export default BackToTop;
