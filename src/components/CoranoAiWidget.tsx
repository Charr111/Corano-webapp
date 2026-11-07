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
  const [nameInputRefFocus, setNameInputRefFocus] = useState(false);
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
    if (location.pathname.startsWith('/admin')) return;
    fetchLiveStoreData()
      .then((live) => {
        setAiEnabled(live.settings?.aiEnabled !== false);
        setStoreCurrency(live.settings?.currency === 'LBP' ? 'LBP' : 'USD');
        setExchangeRate(live.settings?.exchangeRate || DEFAULT_LBP_RATE);
        setAllItems(live.items || []);
      })
      .catch(() => {
        // use cached
      });
  }, [isOpen, location.pathname]);

  useEffect(() => {
    if (isOpen) {
      const freshCachedName = getCachedGuestName();
      if (freshCachedName && freshCachedName !== guestName) {
        setGuestName(freshCachedName);
      }
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages, isThinking, isOpen, guestName]);

  if (location.pathname.startsWith('/admin') || !aiEnabled) {
    return null;
  }

  const handleSaveGuestName = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = nameDraft.trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!cleaned) return;
    saveCachedGuestName(cleaned);
    setGuestName(cleaned);
    setNameDraft('');
    setNameInputRefFocus(false);
  };

  const handleSendQuestion = async (rawQuestion: string) => {
    const trimmed = rawQuestion.trim();
    if (!trimmed || isThinking) return;

    let activeGuestName = guestName;
    if (!activeGuestName) {
      const fromDraft = nameDraft.trim().replace(/\s+/g, ' ').slice(0, 60);
      if (fromDraft) {
        saveCachedGuestName(fromDraft);
        setGuestName(fromDraft);
        setNameDraft('');
        setNameInputRefFocus(false);
        activeGuestName = fromDraft;
      } else {
        setNameInputRefFocus(true);
        nameInputRef.current?.focus();
        return;
      }
    }

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
        .slice(0, 3);
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: 'Welcome to Corano! Here are some of our guests’ favorite freshly prepared dishes:',
          recommendedItems:
            fallbackPicks.length > 0 ? fallbackPicks : allItems.slice(0, 3),
        },
      ]);
    } finally {
      setIsThinking(false);
    }
  };

  const handleResetChat = () => {
    setMessages([]);
    setPreviewItem(null);
    setSessionId(`chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  };

  return (
    <>
      {/* Floating Corano AI Bubble (Cleanly above the h-16 Bottom Nav Bar on both mobile & desktop) */}
      <div className="fixed bottom-20 right-4 md:bottom-20 md:right-6 z-40 flex flex-col items-center">
        {!isOpen && (
          <motion.button
            type="button"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => setIsOpen(true)}
            className="relative z-10 -mb-1.5 bg-[#101010] border border-[#E4CD86]/70 text-[#E4CD86] text-[9px] leading-none font-headline font-bold tracking-wider uppercase px-2 py-[3px] rounded-full shadow-md hover:border-[#E4CD86] transition-colors cursor-pointer whitespace-nowrap"
          >
            Corano AI
          </motion.button>
        )}

        <motion.button
          type="button"
          whileTap={{ scale: 0.94 }}
          onClick={() => setIsOpen((prev) => !prev)}
          aria-label="Open Corano AI Waiter"
          className="w-13 h-13 rounded-full bg-[#101010] border-2 border-[#E4CD86] text-[#E4CD86] shadow-[0_8px_28px_rgba(228,205,134,0.32)] flex items-center justify-center hover:bg-[#181818] transition-colors cursor-pointer relative"
        >
          <span className="material-symbols-outlined text-[25px]">
            {isOpen ? 'close' : 'auto_awesome'}
          </span>
        </motion.button>
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
                    <span className="material-symbols-outlined text-[20px]">room_service</span>
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
                      <span className="material-symbols-outlined text-[18px]">refresh</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    aria-label="Close Corano AI"
                    className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors"
                  >
                    <span className="material-symbols-outlined text-[20px]">close</span>
                  </button>
                </div>
              </div>

              {/* Minimal, Non-Pushy First-Time Name / Nickname Bar */}
              {!guestName && (
                <form
                  onSubmit={handleSaveGuestName}
                  className={`px-4 py-2.5 bg-[#151514] border-b transition-colors shrink-0 ${
                    nameInputRefFocus ? 'border-[#E4CD86]' : 'border-outline-variant/30'
                  }`}
                >
                  <label className="block text-[11px] text-on-surface-variant mb-1.5">
                    Add your <span className="text-[#E4CD86] font-medium">name & last name or nickname</span> to chat:
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      ref={nameInputRef}
                      type="text"
                      dir="auto"
                      maxLength={60}
                      value={nameDraft}
                      onChange={(e) => {
                        setNameDraft(e.target.value);
                        if (nameInputRefFocus) setNameInputRefFocus(false);
                      }}
                      placeholder="Name & last name or nickname..."
                      className="flex-1 bg-[#101010] border border-outline-variant/40 focus:border-[#E4CD86] rounded-lg px-3 py-1.5 text-base sm:text-xs text-on-surface placeholder-on-surface-variant/60 focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={!nameDraft.trim()}
                      className="px-3 py-1.5 rounded-lg bg-[#E4CD86] text-[#101010] font-bold text-xs hover:bg-[#E4CD86]/90 disabled:opacity-40 transition-opacity shrink-0 cursor-pointer"
                    >
                      Save
                    </button>
                  </div>
                </form>
              )}

              {/* Scrollable Messages Area */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 hide-scrollbar">
                    {/* Initial Welcome Card + 5 Pre-Written Suggestion Questions */}
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
                            <span className="material-symbols-outlined text-[15px] shrink-0">
                              arrow_forward
                            </span>
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
                                    <span className="material-symbols-outlined text-2xl text-outline-variant">
                                      restaurant
                                    </span>
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
                  <span className="material-symbols-outlined text-[20px]">send</span>
                </button>
              </form>

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
                          <span className="material-symbols-outlined text-5xl text-outline-variant">
                            restaurant
                          </span>
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
                        <span className="material-symbols-outlined">close</span>
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
