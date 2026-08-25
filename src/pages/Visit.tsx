import React from 'react';
import { motion } from 'motion/react';

const Visit = () => {
  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      className="relative min-h-full py-12 px-4 sm:px-6 lg:px-8"
    >
      <div className="fixed inset-0 z-0 pointer-events-none">
        <img src="/visit-bg.jpg" alt="Visit Background" className="w-full h-full object-cover" fetchPriority="high" loading="eager" />
        <div className="absolute inset-0 bg-background/60"></div>
      </div>
      <div className="relative z-10 max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h1 className="font-headline text-4xl md:text-5xl text-primary mb-4">Visit Us</h1>
          <p className="text-xl text-on-surface-variant max-w-2xl mx-auto">
            Join us for an unforgettable dining experience. We are ready to welcome you.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-12 items-center">
          {/* Info Card */}
          <div className="bg-surface-container-low p-8 md:p-12 rounded-3xl border border-outline-variant/30">
            <div className="space-y-8">
              <div className="flex items-start space-x-4">
                <span className="material-symbols-outlined text-primary text-3xl">location_on</span>
                <div>
                  <h3 className="font-bold text-xl text-on-surface mb-2">Location</h3>
                  <p className="text-on-surface-variant leading-relaxed">
                    Corano Restaurant<br />
                    Discover our exact location on the map<br />
                    and navigate directly to our doors.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-4">
                <span className="material-symbols-outlined text-primary text-3xl">schedule</span>
                <div>
                  <h3 className="font-bold text-xl text-on-surface mb-2">Opening Hours</h3>
                  <p className="text-on-surface-variant leading-relaxed">
                    Monday - Sunday<br />
                    11:00 AM - 12:00 AM
                  </p>
                </div>
              </div>

              <div className="pt-6">
                <a 
                  href="https://maps.app.goo.gl/55HsEWA2CjypowFKA" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="inline-flex items-center space-x-2 bg-primary text-on-primary px-8 py-4 rounded-full font-bold hover:bg-primary/90 transition-transform hover:scale-105"
                >
                  <span className="material-symbols-outlined">directions</span>
                  <span>Get Directions</span>
                </a>
              </div>
            </div>
          </div>

          {/* Map Embed */}
          <div className="flex flex-col gap-4">
            <div className="relative h-[400px] md:h-[500px] rounded-3xl overflow-hidden border border-outline-variant/30 shadow-lg bg-surface-container">
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
                className="px-8 py-3 border-2 border-primary text-primary rounded-full font-bold hover:bg-primary hover:text-on-primary transition-colors flex items-center gap-2"
              >
                <span className="material-symbols-outlined">map</span>
                Open Map
              </a>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default Visit;
