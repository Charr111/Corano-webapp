import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { fetchLiveStoreData, getCachedStoreData } from '../utils/r2DataClient';
import { StoreDataPayload } from '../types';

function getLocalTodayKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function hashBannerUrl(url: string): string {
  let h = 5381;
  for (let i = 0; i < url.length; i++) {
    h = ((h << 5) + h) ^ url.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

function readDailyBannerViews(storageKey: string): number {
  let count = 0;
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed > count) count = parsed;
    }
  } catch {
    // ignore storage errors
  }
  try {
    const match = document.cookie
      .split('; ')
      .find((row) => row.startsWith(`${encodeURIComponent(storageKey)}=`));
    if (match) {
      const parsed = parseInt(decodeURIComponent(match.split('=')[1] || '0'), 10);
      if (Number.isFinite(parsed) && parsed > count) count = parsed;
    }
  } catch {
    // ignore cookie errors
  }
  return count;
}

function writeDailyBannerViews(storageKey: string, nextCount: number): void {
  try {
    localStorage.setItem(storageKey, String(nextCount));
  } catch {
    // ignore storage errors
  }
  try {
    const maxAge = 60 * 60 * 24 * 2; // 48 hours
    document.cookie = `${encodeURIComponent(storageKey)}=${encodeURIComponent(
      String(nextCount)
    )}; path=/; max-age=${maxAge}; SameSite=Lax`;
  } catch {
    // ignore cookie errors
  }
}

const PromoBannerModal: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const isAdminRoute = location.pathname.startsWith('/admin');

  const [promoBannerOpen, setPromoBannerOpen] = useState(false);
  const [promoBannerUrl, setPromoBannerUrl] = useState('');
  const [promoBannerClickToMenu, setPromoBannerClickToMenu] = useState(true);
  const [promoBannerTargetUrl, setPromoBannerTargetUrl] = useState('/menu');

  useEffect(() => {
    if (isAdminRoute) {
      setPromoBannerOpen(false);
      return;
    }

    let cancelled = false;
    let timerId: number | null = null;

    const evaluateAndScheduleBanner = (store: StoreDataPayload) => {
      if (cancelled) return;
      const settings = store?.settings;
      const enabled = settings?.promoBannerEnabled === true;
      const bannerUrl = (settings?.promoBannerUrl || '').trim();
      if (!enabled || !bannerUrl) {
        setPromoBannerOpen(false);
        return;
      }

      const delaySec =
        typeof settings?.promoBannerDelaySeconds === 'number' &&
        settings.promoBannerDelaySeconds >= 0 &&
        settings.promoBannerDelaySeconds <= 60
          ? settings.promoBannerDelaySeconds
          : 2;
      const maxPerDay =
        typeof settings?.promoBannerMaxPerDay === 'number' &&
        settings.promoBannerMaxPerDay >= 0 &&
        settings.promoBannerMaxPerDay <= 20
          ? settings.promoBannerMaxPerDay
          : 2;
      const clickToMenu = settings?.promoBannerClickToMenu !== false;
      const targetUrl =
        typeof settings?.promoBannerTargetUrl === 'string' &&
        settings.promoBannerTargetUrl.trim().length > 0
          ? settings.promoBannerTargetUrl.trim()
          : '/menu';

      const ipTag = (store.clientIpHash || 'device').trim();
      const todayKey = getLocalTodayKey();
      const bannerHash = hashBannerUrl(bannerUrl);
      const impressionKey = `corano_promo_${todayKey}_${ipTag}_${bannerHash}`;
      const globalDayKey = `corano_promo_${todayKey}_device_${bannerHash}`;

      const viewsSoFar = Math.max(
        readDailyBannerViews(impressionKey),
        readDailyBannerViews(globalDayKey)
      );

      if (maxPerDay > 0 && viewsSoFar >= maxPerDay) {
        return;
      }

      setPromoBannerUrl(bannerUrl);
      setPromoBannerClickToMenu(clickToMenu);
      setPromoBannerTargetUrl(targetUrl);

      if (timerId !== null) {
        window.clearTimeout(timerId);
      }

      timerId = window.setTimeout(() => {
        if (cancelled) return;
        const currentViews = Math.max(
          readDailyBannerViews(impressionKey),
          readDailyBannerViews(globalDayKey)
        );
        if (maxPerDay > 0 && currentViews >= maxPerDay) {
          return;
        }
        const nextViews = currentViews + 1;
        writeDailyBannerViews(impressionKey, nextViews);
        writeDailyBannerViews(globalDayKey, nextViews);
        setPromoBannerOpen(true);
      }, delaySec * 1000);
    };

    fetchLiveStoreData()
      .then((liveStore) => {
        evaluateAndScheduleBanner(liveStore);
      })
      .catch(() => {
        const cached = getCachedStoreData();
        evaluateAndScheduleBanner(cached);
      });

    return () => {
      cancelled = true;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, [isAdminRoute]);

  if (isAdminRoute) return null;

  return (
    <AnimatePresence>
      {promoBannerOpen && promoBannerUrl && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onClick={() => setPromoBannerOpen(false)}
          className="fixed inset-0 z-[10000] bg-black/75 backdrop-blur-sm flex items-center justify-center px-5 py-6 sm:p-6"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 10 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            className="relative flex flex-col items-center justify-center max-w-[88vw] sm:max-w-[420px]"
          >
            {/* Top-Right Close (✕) Button - 10% smaller on mobile & safely inset from screen edges */}
            <button
              type="button"
              aria-label="Close promotional banner"
              onClick={() => setPromoBannerOpen(false)}
              className="absolute top-2.5 right-2.5 sm:-top-3 sm:-right-3 z-20 w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-black/85 text-[#E4CD86] border border-[#E4CD86]/60 shadow-xl backdrop-blur-xs flex items-center justify-center text-sm sm:text-base font-bold hover:bg-[#E4CD86] hover:text-black active:scale-95 transition-all"
            >
              <svg className="w-4 h-4 sm:w-4.5 sm:h-4.5 fill-current shrink-0" viewBox="0 -960 960 960" aria-hidden="true">
                <path d="m256-214-42-42 224-224-224-224 42-42 224 224 224-224 42 42-224 224 224 224-42 42-224-224-224 224Z" />
              </svg>
            </button>

            <img
              src={promoBannerUrl}
              alt="Corano Special Promotion"
              onClick={() => {
                if (promoBannerClickToMenu) {
                  setPromoBannerOpen(false);
                  const dest = promoBannerTargetUrl || '/menu';
                  navigate(dest);
                }
              }}
              className={`max-h-[78dvh] sm:max-h-[80dvh] max-w-[88vw] sm:max-w-[420px] w-auto h-auto object-contain rounded-2xl shadow-2xl border border-[#E4CD86]/40 select-none ${
                promoBannerClickToMenu ? 'cursor-pointer active:scale-[0.99] transition-transform' : ''
              }`}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default PromoBannerModal;
