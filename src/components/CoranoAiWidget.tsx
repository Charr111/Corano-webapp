import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { MenuItem } from '../types';
import { DEFAULT_LBP_RATE, formatStorePrice, StoreCurrency } from '../utils/currency';
import {
  askCoranoAiWaiter,
  fetchLiveStoreData,
  getCachedStoreData,
} from '../utils/r2DataClient';

interface WidgetMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  recommendedItems?: MenuItem[];
}

const SUGGESTED_QUESTIONS = [
  '★ What are your most popular dishes?',
  '🍔 Recommend a filling burger or sub',
  '🥗 What light or healthy options do you have?',
  '🧄 What dishes do you have without garlic?',
  '🧀 Recommend something crispy or cheesy',
  '🔥 What types of Mashewe do you have?',
];

const GUEST_PROFILE_CACHE_KEY = 'corano_ai_guest_profile_v1';
const GUEST_COOKIE_NAME = 'corano_ai_guest_name';
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

function readGuestCookie(): string {
  try {
    if (typeof document === 'undefined' || !document.cookie) return '';
    const match = document.cookie
      .split('; ')
      .find((row) => row.startsWith(`${GUEST_COOKIE_NAME}=`));
    if (!match) return '';
    const val = decodeURIComponent(match.split('=').slice(1).join('=')).trim();
    return val.slice(0, 60);
  } catch {
    return '';
  }
}

function saveCachedGuestName(name: string): void {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!clean) return;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(
        GUEST_PROFILE_CACHE_KEY,
        JSON.stringify({
          name: clean,
          expiresAt: Date.now() + ONE_YEAR_MS,
        })
      );
    }
  } catch {
    // Ignore storage quota / private browsing errors safely
  }
  try {
    if (typeof document !== 'undefined') {
      document.cookie = `${GUEST_COOKIE_NAME}=${encodeURIComponent(
        clean
      )}; path=/; max-age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
    }
  } catch {
    // Ignore cookie errors safely
  }
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.storage &&
      typeof navigator.storage.persist === 'function'
    ) {
      navigator.storage.persist().catch(() => {});
    }
  } catch {
    // Ignore
  }
}

function getCachedGuestName(): string {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(GUEST_PROFILE_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          parsed &&
          typeof parsed.name === 'string' &&
          parsed.name.trim().length > 0 &&
          typeof parsed.expiresAt === 'number' &&
          Date.now() < parsed.expiresAt
        ) {
          const validName = parsed.name.trim().slice(0, 60);
          // Rolling refresh on every visit/interaction so WebKit ITP & browser storage stay active
          saveCachedGuestName(validName);
          return validName;
        }
        window.localStorage.removeItem(GUEST_PROFILE_CACHE_KEY);
      }
    }
  } catch {
    // fallback to first-party cookie
  }

  const cookieName = readGuestCookie();
  if (cookieName) {
    saveCachedGuestName(cookieName);
    return cookieName;
  }
  return '';
}

const CoranoAiWidget: React.FC = () => {
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [guestName, setGuestName] = useState<string>(() => getCachedGuestName());
  const [nameDraft, setNameDraft] = useState<string>('');
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [showNameModal, setShowNameModal] = useState(false);
  const [sessionId, setSessionId] = useState<string>(
    () => `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  );
  const [messages, setMessages] = useState<WidgetMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [previewItem, setPreviewItem] = useState<MenuItem | null>(null);

  const initialStore = getCachedStoreData();
  const [aiEnabled, setAiEnabled] = useState<boolean>(
    initialStore.settings?.aiEnabled !== false
  );
  const [storeCurrency, setStoreCurrency] = useState<StoreCurrency>(
    initialStore.settings?.currency === 'LBP' ? 'LBP' : 'USD'
  );
  const [exchangeRate, setExchangeRate] = useState<number>(
    initialStore.settings?.exchangeRate || DEFAULT_LBP_RATE
  );
  const [allItems, setAllItems] = useState<MenuItem[]>(initialStore.items || []);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const applySettingsFromStore = (store: ReturnType<typeof getCachedStoreData>) => {
      if (!store) return;
      setAiEnabled(store.settings?.aiEnabled !== false);
      setStoreCurrency(store.settings?.currency === 'LBP' ? 'LBP' : 'USD');
      setExchangeRate(store.settings?.exchangeRate || DEFAULT_LBP_RATE);
      setAllItems(store.items || []);
    };

    fetchLiveStoreData()
      .then((live) => {
        applySettingsFromStore(live);
      })
      .catch(() => {
        // use cached
      });

    const handleStoreUpdated = (evt: Event) => {
      const customEvt = evt as CustomEvent;
      if (customEvt.detail) {
        applySettingsFromStore(customEvt.detail);
      } else {
        applySettingsFromStore(getCachedStoreData());
      }
    };

    window.addEventListener('corano-store-updated', handleStoreUpdated);
    return () => {
      window.removeEventListener('corano-store-updated', handleStoreUpdated);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      const freshCachedName = getCachedGuestName();
      if (freshCachedName && freshCachedName !== guestName) {
        setGuestName(freshCachedName);
      }
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages, isThinking, isOpen, guestName]);

  useEffect(() => {
    if (showNameModal) {
      const timer = setTimeout(() => {
        nameInputRef.current?.focus();
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [showNameModal]);

  const normalizedPath = location.pathname.toLowerCase();
  const isAllowedRoute =
    normalizedPath === '/' ||
    normalizedPath === '/home' ||
    normalizedPath.startsWith('/menu') ||
    normalizedPath.startsWith('/admin');

  if (!isAllowedRoute || !aiEnabled) {
    return null;
  }

  const executeSendQuestion = async (trimmed: string, activeGuestName: string) => {
    if (!trimmed || isThinking) return;

    const userMsg: WidgetMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: trimmed,
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInputText('');
    setIsThinking(true);

    try {
      const historyPayload = nextMessages.slice(-10).map((m) => ({
        role: m.role,
        text: m.text,
        recommendedItemIds: m.recommendedItems?.map((item) => item.id),
      }));

      const res = await askCoranoAiWaiter({
        sessionId,
        guestName: activeGuestName,
        message: trimmed,
        history: historyPayload,
      });

      if (res.sessionId) {
        setSessionId(res.sessionId);
      }

      let recommendedItems: MenuItem[] = [];
      if (Array.isArray(res.recommendedItems) && res.recommendedItems.length > 0) {
        recommendedItems = res.recommendedItems;
      } else if (Array.isArray(res.recommendedItemIds) && res.recommendedItemIds.length > 0) {
        recommendedItems = res.recommendedItemIds
          .map((id) => allItems.find((i) => i.id === id))
          .filter((i): i is MenuItem => Boolean(i));
      }

      const aiMsg: WidgetMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        text: res.reply,
        recommendedItems,
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch {
      const fallbackPicks = allItems
        .filter((i) => i.available !== false && i.popular)
        .slice(0, 4);
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: 'Welcome to Corano! Here are some of our guests’ favorite freshly prepared dishes:',
          recommendedItems:
            fallbackPicks.length > 0 ? fallbackPicks : allItems.slice(0, 4),
        },
      ]);
    } finally {
      setIsThinking(false);
    }
  };

  const handleSendQuestion = async (rawQuestion: string) => {
    const trimmed = rawQuestion.trim();
    if (!trimmed || isThinking) return;

    const currentName = guestName || getCachedGuestName();
    if (!currentName) {
      setPendingQuestion(trimmed);
      setShowNameModal(true);
      return;
    }

    if (currentName !== guestName) {
      setGuestName(currentName);
    }
    await executeSendQuestion(trimmed, currentName);
  };

  const handleConfirmNameAndSend = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = nameDraft.trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!cleaned) return;
    saveCachedGuestName(cleaned);
    setGuestName(cleaned);
    setNameDraft('');
    setShowNameModal(false);
    const questionToSend = pendingQuestion;
    setPendingQuestion(null);
    if (questionToSend) {
      void executeSendQuestion(questionToSend, cleaned);
    }
  };

  const handleResetChat = () => {
    setMessages([]);
    setPreviewItem(null);
    setSessionId(`chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  };

  const isIosMobile =
    typeof navigator !== 'undefined' &&
    (/iPhone|iPod|iPad/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

  const isAndroidMobile =
    typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

  return (
    <>
      {/* Floating Corano AI Bubble (Optimized for mobile & desktop, 5% smaller on Android only, with speech bubble above circle) */}
      <div
        className={`fixed ${
          isIosMobile
            ? 'bottom-[calc(5.35rem+env(safe-area-inset-bottom))] right-3'
            : 'bottom-[calc(4.35rem+env(safe-area-inset-bottom))] right-2.5'
        } sm:bottom-20 sm:right-6 z-40 flex flex-col items-end ${
          isAndroidMobile ? 'scale-[0.95] origin-bottom-right' : ''
        }`}
      >
        <AnimatePresence>
          {!isOpen && (
            <motion.button
              key="ask-waiter-callout"
              type="button"
              initial={{ opacity: 0, y: 5, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.92 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              onClick={() => setIsOpen(true)}
              aria-label="Ask AI Waiter"
              className="relative z-10 mb-2 bg-[#1A1917]/95 border border-[#E4CD86]/85 text-[#F5EFE0] text-[9.5px] sm:text-[10.5px] leading-none font-headline font-medium tracking-wide px-2.5 sm:px-3 py-[5px] sm:py-[6px] rounded-full shadow-[0_4px_14px_rgba(0,0,0,0.75)] hover:border-[#E4CD86] transition-colors cursor-pointer whitespace-nowrap"
            >
              <span>Ask AI Waiter</span>
              {/* Downward Speech Triangle Pointer aligned over the AI circle */}
              <span
                aria-hidden="true"
                className="
                  absolute -bottom-[4.5px] right-[18px] sm:right-[22px]
                  w-2 h-2 bg-[#1A1917]
                  border-b border-r border-[#E4CD86]/85
                  rotate-45
                "
              />
            </motion.button>
          )}
        </AnimatePresence>

        <div className="relative flex items-center justify-center">
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            onClick={() => setIsOpen((prev) => !prev)}
            aria-label="Open Corano AI Waiter"
            className="w-11 h-11 sm:w-13 sm:h-13 rounded-full bg-[#141413] border-[1.75px] border-[#E4CD86] text-[#E4CD86] shadow-[0_8px_28px_rgba(228,205,134,0.32)] flex items-center justify-center hover:bg-[#1C1B18] transition-colors cursor-pointer relative"
          >
            {isOpen ? (
              <svg className="w-[21px] h-[21px] sm:w-[25px] sm:h-[25px] fill-current shrink-0" viewBox="0 -960 960 960" aria-hidden="true">
                <path d="m256-214-42-42 224-224-224-224 42-42 224 224 224-224 42 42-224 224 224 224-42 42-224-224-224 224Z" />
              </svg>
            ) : (
              <svg className="w-[21px] h-[21px] sm:w-[25px] sm:h-[25px] fill-current shrink-0" viewBox="0 -960 960 960" aria-hidden="true">
                <path d="m744-96-30-66-66-30 66-30 30-66 30 66 66 30-66 30-30 66Zm0-576-30-66-66-30 66-30 30-66 30 66 66 30-66 30-30 66ZM396-204l-79-173-173-79 173-79 79-173 79 173 173 79-173 79-79 173Zm0-137 32-70 70-32-70-32-32-70-32 70-70 32 70 32 32 70Zm0-102Z" />
              </svg>
            )}
          </motion.button>
        </div>
      </div>

      {/* Chat Modal Window */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9998] flex items-end sm:items-center justify-center sm:justify-end bg-black/75 backdrop-blur-xs sm:p-6"
            onClick={() => setIsOpen(false)}
          >
            <motion.div
              initial={{ y: '100%', opacity: 0.8 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 26, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[#101010] border-t sm:border border-[#E4CD86]/35 w-full sm:w-[410px] h-[84dvh] sm:h-[630px] max-h-[88dvh] rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden relative"
            >
              {/* Modal Top Bar */}
              <div className="px-5 py-4 bg-[#161615] border-b border-outline-variant/30 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-[#101010] border border-[#E4CD86]/60 flex items-center justify-center text-[#E4CD86]">
                    <svg className="w-5 h-5 fill-current shrink-0" viewBox="0 -960 960 960" aria-hidden="true">
                      <path d="M120-210v-60h720v60H120Zm24-110q12-122 93.5-209.5T444-634v-46q0-15 10.5-25.5T480-716q15 0 25.5 10.5T516-680v46q125 17 206.5 104.5T816-320H144Zm64-60h544q-17-95-88.5-157.5T480-600q-112 0-183.5 62.5T208-380Zm272 0Z" />
                    </svg>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-headline font-bold text-base text-on-surface leading-none">
                        Corano AI Waiter
                      </h3>
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    </div>
                    {guestName && (
                      <p className="text-[11px] text-on-surface-variant mt-1">
                        Hi, <span className="text-[#E4CD86] font-semibold">{guestName}</span>
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {messages.length > 0 && (
                    <button
                      type="button"
                      onClick={handleResetChat}
                      title="Start new conversation"
                      className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-[#E4CD86] transition-colors"
                    >
                      <svg className="w-[18px] h-[18px] fill-current shrink-0" viewBox="0 -960 960 960" aria-hidden="true">
                        <path d="M480-180q-125 0-212.5-87.5T180-480q0-125 87.5-212.5T480-780q71 0 132 31t104 87v-118h60v220H556v-60h117q-32-45-81.5-72.5T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q87 0 151.5-54T714-432h62q-18 111-101.5 181.5T480-180Z" />
                      </svg>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    aria-label="Close Corano AI"
                    className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors"
                  >
                    <svg className="w-5 h-5 fill-current shrink-0" viewBox="0 -960 960 960" aria-hidden="true">
                      <path d="m256-214-42-42 224-224-224-224 42-42 224 224 224-224 42 42-224 224 224 224-42 42-224-224-224 224Z" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Scrollable Messages Area */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 hide-scrollbar">
                    {/* Initial Welcome Card + Pre-Written Suggestion Questions */}
                    <div className="bg-[#181817] border border-outline-variant/30 rounded-2xl p-4 space-y-3">
                      <p className="text-sm text-on-surface leading-relaxed font-headline">
                        Welcome to <span className="text-[#E4CD86] font-bold">Corano</span>! Ask me
                        about any dish, ingredient, or recommendation:
                      </p>

                      <div className="flex flex-col gap-2 pt-1">
                        {SUGGESTED_QUESTIONS.map((q) => (
                          <button
                            key={q}
                            type="button"
                            disabled={isThinking}
                            onClick={() => handleSendQuestion(q)}
                            className="text-left text-xs sm:text-xs font-medium px-3.5 py-2.5 rounded-xl bg-[#101010] border border-[#E4CD86]/30 text-[#E4CD86] hover:bg-[#E4CD86]/10 hover:border-[#E4CD86] transition-all flex items-center justify-between gap-2 cursor-pointer disabled:opacity-50"
                          >
                            <span>{q}</span>
                            <svg className="w-[15px] h-[15px] fill-current shrink-0" viewBox="0 -960 960 960" aria-hidden="true">
                              <path d="M666-450H180v-60h486L438-738l42-42 300 300-300 300-42-42 228-228Z" />
                            </svg>
                          </button>
                        ))}
                      </div>
                    </div>

                {/* Conversation Thread */}
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      msg.role === 'user' ? 'items-end' : 'items-start'
                    }`}
                  >
                    <div
                      dir="auto"
                      className={`max-w-[86%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-[#E4CD86] text-[#101010] font-semibold rounded-br-xs'
                          : 'bg-[#181817] text-on-surface border border-outline-variant/30 rounded-bl-xs'
                      }`}
                    >
                      {msg.text}
                    </div>

                    {/* Visual Recommended Dish Cards (Tamr-Style) */}
                    {msg.role === 'assistant' &&
                      msg.recommendedItems &&
                      msg.recommendedItems.length > 0 && (
                        <div className="w-full mt-2.5 flex gap-2.5 overflow-x-auto hide-scrollbar pb-1">
                          {msg.recommendedItems.map((dish) => (
                            <button
                              key={dish.id}
                              type="button"
                              onClick={() => setPreviewItem(dish)}
                              className="w-40 shrink-0 bg-[#181817] border border-outline-variant/35 hover:border-[#E4CD86] rounded-2xl overflow-hidden text-left transition-colors flex flex-col cursor-pointer"
                            >
                              <div className="w-full h-24 bg-surface-container relative overflow-hidden">
                                {dish.img ? (
                                  <img
                                    src={dish.img}
                                    alt={dish.title}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <svg className="w-6 h-6 fill-current text-outline-variant" viewBox="0 -960 960 960" aria-hidden="true">
                                      <path d="M292-120v-334q-50-11-83-52t-33-98v-236h60v236q0 28 19 47t47 19q28 0 47-19t19-47v-236h60v236q0 57-33 98t-83 52v334h-60Zm364 0v-320H548v-284q0-69 48.5-112.5T716-880v760h-60Z" />
                                    </svg>
                                  </div>
                                )}
                                {dish.popular && (
                                  <span className="absolute top-1.5 left-1.5 bg-[#101010]/90 text-[#E4CD86] border border-[#E4CD86]/40 text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                                    ★ Popular
                                  </span>
                                )}
                              </div>
                              <div className="p-2.5 flex flex-col justify-between flex-1">
                                <div className="font-headline text-xs font-semibold text-on-surface line-clamp-1">
                                  {dish.title}
                                </div>
                                <div className="text-xs font-bold text-[#E4CD86] mt-1">
                                  {formatStorePrice(dish.price, storeCurrency, exchangeRate)}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                  </div>
                ))}

                {isThinking && (
                  <div className="flex items-center gap-2 text-xs text-on-surface-variant px-2 py-1">
                    <span className="w-2 h-2 rounded-full bg-[#E4CD86] animate-bounce" />
                    <span
                      className="w-2 h-2 rounded-full bg-[#E4CD86] animate-bounce"
                      style={{ animationDelay: '150ms' }}
                    />
                    <span
                      className="w-2 h-2 rounded-full bg-[#E4CD86] animate-bounce"
                      style={{ animationDelay: '300ms' }}
                    />
                    <span className="ml-1 font-headline italic">Corano AI is checking the menu...</span>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Bottom Input Form */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendQuestion(inputText);
                }}
                className="p-3.5 bg-[#161615] border-t border-outline-variant/30 flex items-center gap-2 shrink-0 pb-[calc(0.875rem+env(safe-area-inset-bottom))] sm:pb-3.5"
              >
                <input
                  type="text"
                  dir="auto"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Ask about any dish, ingredient, or allergy..."
                  maxLength={400}
                  className="flex-1 bg-[#101010] border border-outline-variant/40 focus:border-[#E4CD86] rounded-xl px-3.5 py-2.5 text-base sm:text-sm text-on-surface placeholder-on-surface-variant/60 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!inputText.trim() || isThinking}
                  aria-label="Send question"
                  className="w-10 h-10 rounded-xl bg-[#E4CD86] text-[#101010] flex items-center justify-center hover:bg-[#E4CD86]/90 disabled:opacity-40 transition-opacity shrink-0 cursor-pointer"
                >
                  <svg className="w-5 h-5 fill-current shrink-0" viewBox="0 -960 960 960" aria-hidden="true">
                    <path d="M140-180v-240l300-60-300-60v-240l720 300-720 300Z" />
                  </svg>
                </button>
              </form>

              {/* Minimal Centered Name Pop-Up inside the AI Chat Window */}
              <AnimatePresence>
                {showNameModal && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-5"
                    onClick={() => setShowNameModal(false)}
                  >
                    <motion.form
                      initial={{ scale: 0.94, opacity: 0, y: 6 }}
                      animate={{ scale: 1, opacity: 1, y: 0 }}
                      exit={{ scale: 0.94, opacity: 0, y: 6 }}
                      transition={{ duration: 0.16 }}
                      onClick={(e) => e.stopPropagation()}
                      onSubmit={handleConfirmNameAndSend}
                      className="w-full max-w-[285px] bg-[#161615] border border-[#E4CD86]/50 rounded-2xl p-4 shadow-2xl space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-headline font-bold text-[#E4CD86] tracking-wide">
                          Type your name to continue
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowNameModal(false)}
                          className="text-on-surface-variant hover:text-on-surface transition-colors"
                          aria-label="Close name prompt"
                        >
                          <svg className="w-4 h-4 fill-current shrink-0" viewBox="0 -960 960 960" aria-hidden="true">
                            <path d="m256-214-42-42 224-224-224-224 42-42 224 224 224-224 42 42-224 224 224 224-42 42-224-224-224 224Z" />
                          </svg>
                        </button>
                      </div>
                      <input
                        ref={nameInputRef}
                        type="text"
                        dir="auto"
                        maxLength={60}
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        placeholder="Your name or nickname..."
                        className="w-full bg-[#101010] border border-outline-variant/50 focus:border-[#E4CD86] rounded-xl px-3 py-2 text-base sm:text-xs text-on-surface placeholder-on-surface-variant/60 focus:outline-none"
                      />
                      <button
                        type="submit"
                        disabled={!nameDraft.trim()}
                        className="w-full py-2 rounded-xl bg-[#E4CD86] text-[#101010] font-bold text-xs hover:bg-[#E4CD86]/90 disabled:opacity-40 transition-opacity cursor-pointer"
                      >
                        Send Message
                      </button>
                    </motion.form>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Dish Detail Preview Overlay inside the Widget */}
              <AnimatePresence>
                {previewItem && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 20 }}
                    className="absolute inset-0 z-50 bg-[#101010] flex flex-col overflow-hidden"
                  >
                    <div className="relative w-full h-56 bg-surface-container-lowest shrink-0">
                      {previewItem.img ? (
                        <img
                          src={previewItem.img}
                          alt={previewItem.title}
                          className="w-full h-full object-contain p-2 bg-surface"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <svg className="w-12 h-12 fill-current text-outline-variant" viewBox="0 -960 960 960" aria-hidden="true">
                            <path d="M292-120v-334q-50-11-83-52t-33-98v-236h60v236q0 28 19 47t47 19q28 0 47-19t19-47v-236h60v236q0 57-33 98t-83 52v334h-60Zm364 0v-320H548v-284q0-69 48.5-112.5T716-880v760h-60Z" />
                          </svg>
                        </div>
                      )}
                      {previewItem.popular && (
                        <div className="absolute top-3 left-3 bg-[#101010]/90 text-[#E4CD86] border border-[#E4CD86]/50 font-bold text-xs uppercase tracking-wider px-3 py-1 rounded-full">
                          ★ Popular
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => setPreviewItem(null)}
                        aria-label="Back to chat"
                        className="absolute top-3 right-3 bg-black/60 backdrop-blur-md text-white rounded-full p-2 hover:bg-black/80 transition-colors"
                      >
                        <svg className="w-6 h-6 fill-current shrink-0" viewBox="0 -960 960 960" aria-hidden="true">
                          <path d="m256-214-42-42 224-224-224-224 42-42 224 224 224-224 42 42-224 224 224 224-42 42-224-224-224 224Z" />
                        </svg>
                      </button>
                    </div>

                    <div className="p-5 flex-1 overflow-y-auto space-y-4">
                      <div className="flex items-start justify-between gap-3">
                        <h4 className="font-headline text-xl font-bold text-on-surface">
                          {previewItem.title}
                        </h4>
                        <span className="text-lg font-bold text-[#E4CD86] whitespace-nowrap">
                          {formatStorePrice(previewItem.price, storeCurrency, exchangeRate)}
                        </span>
                      </div>

                      {previewItem.desc && (
                        <p className="font-headline text-sm text-on-surface-variant leading-relaxed">
                          {previewItem.desc}
                        </p>
                      )}

                      {previewItem.addons && previewItem.addons.length > 0 && (
                        <div className="p-3.5 bg-[#181817] rounded-xl border border-outline-variant/30">
                          <h5 className="font-headline text-xs font-bold text-on-surface mb-2">
                            Options & Add-ons
                          </h5>
                          <ul className="space-y-1.5">
                            {previewItem.addons.map((addon, idx) => (
                              <li
                                key={idx}
                                className="font-headline text-xs text-on-surface-variant flex items-center gap-2"
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-[#E4CD86]" />
                                {addon}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => setPreviewItem(null)}
                        className="w-full py-2.5 rounded-xl bg-surface-container border border-outline-variant/40 text-xs font-semibold text-[#E4CD86] hover:border-[#E4CD86] transition-colors"
                      >
                        ← Back to Corano AI Chat
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default CoranoAiWidget;
