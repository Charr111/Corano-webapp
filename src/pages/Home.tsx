import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';

const Home = () => {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col w-full">
      {/* Hero Section */}
      <section className="relative min-h-[100svh] lg:h-[100svh] lg:min-h-0 flex flex-col items-center justify-between pb-32 pt-6 md:pb-24 md:pt-16 lg:pt-2 lg:pb-12 overflow-hidden shadow-2xl">
        <div className="absolute inset-0 z-0">
          <img
            src="/hero-chicken.jpg"
            alt="Delicious roasted chicken"
            className="w-full h-full object-cover"
            fetchPriority="high"
            loading="eager"
          />
          <div className="absolute inset-0 bg-black/60"></div>
        </div>
        
        {/* Top Logo */}
        <div className="relative z-10 w-full flex justify-center px-4">
          <img src="https://res.cloudinary.com/wlgd4zum/image/upload/f_auto,q_auto/corano-logo" alt="Corano Logo" className="h-32 md:h-64 lg:h-52 w-auto object-contain drop-shadow-xl -ml-6 md:-ml-8" fetchPriority="high" loading="eager" />
        </div>
        
        {/* Main Content */}
        <div className="relative z-10 w-full px-6 flex flex-col items-center mt-auto mb-20 md:mb-24 lg:mb-8 lg:mt-0">
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-primary tracking-[0.3em] text-sm md:text-base uppercase mb-4 lg:mb-2 font-semibold"
          >
            EST. 2001
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
            className="font-headline text-5xl md:text-7xl text-primary italic mb-6 lg:mb-3 drop-shadow-lg"
          >
            Art of Fire.
          </motion.h1>
          
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="font-headline font-bold text-white/95 text-center text-lg md:text-xl lg:text-lg leading-relaxed mb-8 lg:mb-5 max-w-md md:max-w-xl"
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
              onClick={() => navigate('/visit')}
              className="w-full bg-[#E4CD86] text-black font-normal font-['Anton'] text-[16px] py-3.5 md:py-4 lg:py-3 rounded-xl tracking-widest shadow-lg hover:bg-[#E4CD86]/90 transition-transform active:scale-95"
            >
              VISIT US
            </button>
            <button 
              onClick={() => window.open('https://wa.me/9613220810?text=Hello,%20Can%20I%20please%20order?', '_blank')}
              className="w-full bg-[#E4CD86] text-black font-normal font-['Anton'] text-[17px] py-3.5 md:py-4 lg:py-3 rounded-xl tracking-widest shadow-lg hover:bg-[#E4CD86]/90 transition-transform active:scale-95 flex items-center justify-center"
            >
              <div className="relative flex items-center justify-center">
                <svg className="absolute -left-8 w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
              </svg>
              <span>CONTACT US</span>
              </div>
            </button>
          </motion.div>
        </div>
        
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 animate-bounce flex flex-col items-center text-white/50">
          <span className="material-symbols-outlined text-3xl">keyboard_arrow_down</span>
        </div>
      </section>

      {/* Our Story Section */}
      <section className="relative min-h-[100svh] flex items-center justify-center pt-28 pb-24">
        <div className="absolute inset-0 z-0">
          <img
            src="https://res.cloudinary.com/wlgd4zum/image/upload/f_auto,q_auto,w_2000/v1786550183/corano-our-story-resto-food.jpg"
            alt="Our Story Background"
            className="w-full h-full object-cover object-[center_25%]"
            fetchPriority="high"
            loading="eager"
          />
          <div className="absolute inset-0 bg-surface/[0.66]"></div>
        </div>
        
        <div className="relative z-10 max-w-3xl mx-auto px-6 text-center">
          <h2 className="font-headline text-4xl md:text-5xl text-primary mb-8">Our Story</h2>
          <div className="space-y-6 text-lg text-on-surface-variant leading-relaxed">
            <p className="font-headline font-bold italic no-underline">
              At Corano Restaurant, our roots run deep. Founded by our father in a small shop, our family business has grown into a vibrant dining destination through hard work, unity, and a shared passion for great food. But no matter how much we expand, our core philosophy remains exactly the same: love always comes before business.
            </p>
            <p className="font-headline font-bold italic">
              Every meal is prepared with care and served with a genuine smile. We don’t just serve food; we welcome you into our home. Come experience the warmth, laughter, and authentic family hospitality that make Corano Restaurant so special.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Home;
