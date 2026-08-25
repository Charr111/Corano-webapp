import React from 'react';
import { motion } from 'motion/react';

const About = () => {
  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      className="relative min-h-full py-12 px-4 sm:px-6 lg:px-8"
    >
      <div className="fixed inset-0 z-0 pointer-events-none">
        <img src="/visit-bg.jpg" alt="About Background" className="w-full h-full object-cover" fetchPriority="high" loading="eager" />
        <div className="absolute inset-0 bg-background/[0.66]"></div>
      </div>
      <div className="relative z-10 max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="font-headline text-4xl md:text-5xl text-primary mb-4">About Us</h1>
          <div className="w-24 h-1 bg-primary mx-auto mb-6 rounded-full"></div>
          <p className="font-headline text-xl font-bold italic text-on-surface-variant max-w-2xl mx-auto">
            From our kitchen to your plate, with uncompromising quality. Come discover your next favorite Sub!
          </p>
        </div>

        <div className="flex flex-col gap-10 items-center">
          {/* Info Card - Opening Hours Only */}
          <div className="w-full bg-surface-container-low p-8 md:p-10 rounded-3xl border border-outline-variant/30 flex flex-col items-center text-center">
            <span className="material-symbols-outlined text-primary text-4xl mb-4">schedule</span>
            <h3 className="font-headline font-bold text-2xl text-on-surface mb-2">Opening Hours</h3>
            <p className="font-headline text-on-surface-variant leading-relaxed text-lg">
              Monday - Sunday<br />
              11:00 AM - 12:00 AM
            </p>
          </div>

          {/* Map Embed (Shrunk by 20%) */}
          <div className="flex flex-col gap-4 w-full mt-6 md:mt-8">
            <div className="text-center mb-4">
              <h2 className="font-headline text-3xl md:text-4xl text-primary mb-3">Location</h2>
              <div className="w-20 h-1 bg-primary mx-auto rounded-full"></div>
            </div>
            <div className="relative h-[320px] md:h-[400px] rounded-3xl overflow-hidden border border-outline-variant/30 shadow-lg bg-surface-container">
              <iframe
                title="Corano Location"
                src="https://maps.google.com/maps?q=34.0769448,35.646829&t=&z=15&ie=UTF8&iwloc=&output=embed"
                width="100%"
                height="100%"
                style={{ border: 0, filter: 'grayscale(100%) invert(92%) contrast(83%)' }}
                allowFullScreen={false}
                loading="eager"
                referrerPolicy="no-referrer-when-downgrade"
              ></iframe>
            </div>
            <div className="flex justify-center">
              <a 
                href="https://maps.app.goo.gl/55HsEWA2CjypowFKA"
                target="_blank"
                rel="noopener noreferrer"
                className="font-headline px-8 py-3 border-2 border-primary text-primary rounded-full font-bold hover:bg-primary hover:text-on-primary transition-colors flex items-center gap-2"
              >
                <span className="material-symbols-outlined">map</span>
                Open Map
              </a>
            </div>
          </div>

          {/* Our Story Section */}
          <div className="w-full text-center mt-16 md:mt-20 pb-12">
            <h2 className="font-headline text-4xl md:text-5xl text-primary mb-4">Our Story</h2>
            <div className="w-24 h-1 bg-primary mx-auto mb-8 rounded-full"></div>
            <div className="space-y-6 text-xl text-on-surface-variant leading-relaxed">
              <p className="font-headline font-bold italic no-underline">
                At Corano Restaurant, our roots run deep. Founded by our father in a small shop, our family business has grown into a vibrant dining destination through hard work, unity, and a shared passion for great food. But no matter how much we expand, our core philosophy remains exactly the same: love always comes before business.
              </p>
              <p className="font-headline font-bold italic">
                Every meal is prepared with care and served with a genuine smile. We don’t just serve food; we welcome you into our home. Come experience the warmth, laughter, and authentic family hospitality that make Corano Restaurant so special.
              </p>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default About;
