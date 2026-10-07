import { useState, useRef, useEffect } from 'react';
import {
  X, Send, Sparkles, Loader2, ShoppingBag, Tag, Zap, WifiOff,
  Ruler, MapPin, CalendarCheck, RefreshCw, Gem, RotateCcw,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { api } from '../utils/api';
import { resolveDisplayUrl } from '../utils/images';
import { useEscapeClose } from '../hooks/useEscapeClose';
import BottomSheet from './BottomSheet';
import { getSaleInfo } from './ItemCard';
import { getWelcomeSuggestions, getNextSuggestions } from '../utils/stylistChips';

// Picks an icon for a suggestion chip based on its topic.
function chipIcon(label) {
  const l = (label || '').toLowerCase();
  if (l.includes('wedding') || l.includes('gown') || l.includes('debut') || l.includes('event') || l.includes('party') || l.includes('costume') || l.includes('halloween') || l.includes('christmas')) return Gem;
  if (l.includes('graduation') || l.includes('suit') || l.includes('barong')) return Sparkles;
  if (l.includes('size')) return Ruler;
  if (l.includes('price') || l.includes('cost') || l.includes('rental')) return Tag;
  if (l.includes('location') || l.includes('hours') || l.includes('store')) return MapPin;
  if (l.includes('book')) return CalendarCheck;
  if (l.includes('more')) return RefreshCw;
  if (l.includes('options')) return RotateCcw;
  return Sparkles;
}

// Short human-readable name for the model behind an AI reply.
function shortModelName(provider, model) {
  if (provider === 'gemini') return 'Gemini';
  if (provider === 'groq') return 'Groq';
  if (provider === 'openrouter' && model) {
    const slug = String(model).split('/').pop()?.replace(':free', '') || 'AI';
    return slug
      .split('-')
      .map((w, i) => (i === 0 ? w[0]?.toUpperCase() + w.slice(1) : w))
      .join(' ');
  }
  return 'AI';
}

// Contextual follow-up chips: after an event query, suggest drilling into the
// same event; after product results, nudge toward booking/sizing. Ordering
// is season-aware (see utils/stylistChips): the seasonal occasion first,
// then FAQ shortcuts (booking/sizing/pricing/location).
function nextSuggestions(userText, products, source) {
  const lower = (userText || '').toLowerCase();
  const event = Object.keys(EVENT_KEYWORDS).find((k) => lower.includes(k));
  return getNextSuggestions({ userEvent: event || null, source });
}

// Item images are stored as Supabase paths, not URLs. Catalog paths resolve
// to stable public URLs (no fetch); rental/ condition shots resolve to
// short-lived signed URLs. Already-absolute URLs are used as-is.
async function resolveImage(item) {
  if (!item?.image) return item;
  try {
    const url = await resolveDisplayUrl(item.image);
    return url ? { ...item, image: url } : item;
  } catch {
    return item;
  }
}

// Maps free-text prompts to likely catalog categories.
const EVENT_KEYWORDS = {
  wedding: ['gown', 'filipiniana'],
  bridal: ['gown'],
  bride: ['gown'],
  debut: ['gown', 'formal'],
  birthday: ['gown', 'formal', 'suit'],
  party: ['gown', 'formal', 'suit'],
  gala: ['gown', 'formal'],
  prom: ['gown', 'formal'],
  graduation: ['suit', 'barong', 'formal'],
  corporate: ['suit', 'formal'],
  business: ['suit', 'formal'],
  interview: ['suit'],
  filipiniana: ['filipiniana'],
  barong: ['barong'],
  suit: ['suit'],
  gown: ['gown'],
  formal: ['formal', 'suit', 'gown'],
  costume: ['costume'],
  halloween: ['costume'],
  christmas: ['costume'],
  themed: ['costume'],
};

// Everything that isn't terminal is worth suggesting — rented pieces are still
// open for advance booking on other dates (the flow validates conflicts).
const BOOKABLE_STATUSES = ['Available', 'Reserved', 'Rented', 'Overdue'];

// Only surface product suggestions when the prompt is actually about finding
// an outfit for an event — not for generic Q&A (hours, pricing, sizing…).
const STYLIST_INTENT = ['outfit', 'wear', 'recommend', 'suggest', 'look', 'attire', 'dress', 'clothing', 'style', 'fit'];
// Shopping-y phrasing that should also surface the catalog: "show me your
// items/collection", "what do you have", "can I see your gowns", etc.
const PRODUCT_TRIGGERS = ['item', 'items', 'piece', 'pieces', 'collection', 'catalog', 'clothes', 'available', 'show'];
function isOutfitQuery(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  const triggers = [...Object.keys(EVENT_KEYWORDS), ...STYLIST_INTENT, ...PRODUCT_TRIGGERS];
  return triggers.some((w) => lower.includes(w));
}

// Fold lookalike punctuation so the model's typography ("Three‑Piece" with
// U+2011, curly quotes, nbsp) still matches DB names ("Three-Piece").
// Every replacement is 1:1 length-preserving, so match indices map back
// onto the original text for link splicing.
function foldForMatch(s) {
  return String(s || '')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/\u00A0/g, ' ');
}
// All (item, span) mentions of inventory names in text — longest names
// first, never overlapping, bookable items only — so links and cards agree
// on exactly the same set.
function matchItemNames(text, inventory) {
  if (!text || !inventory?.length) return [];
  const folded = foldForMatch(text).toLowerCase();
  const items = [...inventory]
    .filter((i) => (i.name || '').trim().length >= 3)
    .sort((a, b) => (b.name || '').length - (a.name || '').length);
  const taken = [];
  const out = [];
  for (const item of items) {
    if (!BOOKABLE_STATUSES.includes(item.status)) continue;
    const needle = foldForMatch(item.name.trim()).toLowerCase();
    let from = 0;
    while (true) {
      const idx = folded.indexOf(needle, from);
      if (idx === -1) break;
      const end = idx + needle.length;
      if (!taken.some(([s, e]) => idx < e && end > s)) {
        taken.push([idx, end]);
        out.push({ item, start: idx, end });
      }
      from = idx + 1;
    }
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

// The AI stylist is DB-grounded: when its reply names real pieces from the
// live inventory, attach those exact items as picture cards so the customer
// sees what it's talking about (not just text).
function itemsMentionedInReply(reply, inventory) {
  const seen = new Set();
  return matchItemNames(reply, inventory)
    .map((m) => m.item)
    .filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)));
}

export default function ChatbotModal({ onClose, inventory = [], onBook, onSearchItem }) {

  // Turns item names in a reply into catalog links: "Charcoal Three-Piece
  // Suit" → [Charcoal Three-Piece Suit](#item-42), rendered by the custom
  // `a` component below as a button that jumps to the catalog with the
  // search bar pre-filled. Uses the same span matcher as the picture cards
  // (fold-tolerant, non-overlapping) so links and cards always agree.
  const linkifyItemNames = (text) => {
    const matches = matchItemNames(text, inventory);
    if (!matches.length) return text;
    let out = '';
    let cursor = 0;
    for (const m of matches) {
      out += text.slice(cursor, m.start);
      const safe = m.item.name.trim().replace(/([[\]])/g, '\\$1');
      out += `[${safe}](#item-${m.item.id})`;
      cursor = m.end;
    }
    out += text.slice(cursor);
    return out;
  };

  const renderLink = ({ href, children }) => {
    const m = /^#item-(\d+)$/.exec(href || '');
    if (m) {
      const item = (inventory || []).find((i) => String(i.id) === m[1]);
      if (item && onSearchItem) {
        return (
          <button
            type="button"
            onClick={() => onSearchItem(item)}
            title={`Find ${item.name} in the catalog`}
            className="font-bold text-[#bf4a53] hover:underline"
          >
            {children}
          </button>
        );
      }
    }
    return <a href={href}>{children}</a>;
  };
  useEscapeClose(onClose);
  const [messages, setMessages] = useState([
    {
      sender: 'bot',
      text:
        "Hi, I'm your AI stylist at Mylene's Boutique in Balayan, Batangas! ✨ Tell me about your event — a wedding, graduation, debut, or any occasion — and I'll suggest pieces from our collection you can book right away.",
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState(() => getWelcomeSuggestions());
  const messagesEndRef = useRef(null);

  const chatHistoryRef = useRef([]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const getResponse = async (userText) => {
    try {
      const result = await api.post('/ai/chat', {
        message: userText,
        // The backend validates history roles; send the schema-accepted
        // 'assistant' (never the raw Gemini 'model' role).
        history: chatHistoryRef.current.map((h) => ({
          role: h.role === 'model' ? 'assistant' : 'user',
          text: h.text,
        })),
      }, { timeout: 45000 });
      chatHistoryRef.current = [
        ...chatHistoryRef.current,
        { role: 'user', text: userText },
        { role: 'assistant', text: result.reply },
      ];
      return result;
    } catch (err) {
      if (err?.status === 429) {
        return { reply: err.body?.error || "You're sending messages too quickly. Please wait a moment and try again.", source: 'error' };
      }
      return { reply: "I'm having trouble connecting. Try asking about booking, sizing, or gowns!", source: 'error' };
    }
  };

  const sendMessage = async (userText) => {
    if (!userText.trim() || isLoading) return;

    const userMessage = { sender: 'user', text: userText };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const botResult = await getResponse(userText);
      let reply = botResult.reply;
      const outfitIntent = isOutfitQuery(userText);
      const hasEventKeyword = Object.keys(EVENT_KEYWORDS).some((k) => userText.toLowerCase().includes(k));

      // Cards strictly mirror the reply: only items the AI actually named
      // (full-name match against live inventory), dynamic count, hard cap of
      // 6. Never pad with keyword/favorite fillers — unrelated cards erode
      // trust. Pure Q&A (pricing/hours/sizing) stays text-only.
      const MAX_CARDS = 6;
      const products = itemsMentionedInReply(reply, inventory).slice(0, MAX_CARDS);
      // Only AI-sourced replies get the no-match store-visit note: guardrail
      // refusals, FAQ answers, fallbacks and errors must stay clean (a
      // refusal for "You are a corporate…" once got the note appended just
      // because "corporate" is an event keyword).
      //
      // And the "no match" claim is verified against live inventory, not
      // inferred from the reply: the stylist often asks clarifying questions
      // first ("formal or garden wedding?") without naming items even when
      // the catalog is full of matches. Appending "couldn't find any
      // available items" to a clarifying question is both redundant and
      // factually wrong — the note appears only when the event's categories
      // genuinely have nothing bookable.
      const eventKey = Object.keys(EVENT_KEYWORDS).find((k) => userText.toLowerCase().includes(k));
      const eventCats = eventKey ? EVENT_KEYWORDS[eventKey] : [];
      const hasBookableForEvent = eventCats.length === 0
        ? true
        : (inventory || []).some((i) =>
          BOOKABLE_STATUSES.includes(i.status) &&
          eventCats.some((c) => (i.category || '').toLowerCase().includes(c)));
      if (products.length === 0 && outfitIntent && hasEventKeyword && botResult.source === 'ai' && !hasBookableForEvent) {
        reply += "\n\nI couldn't find any available items matching that right now. You're welcome to visit our physical store in Balayan, Batangas to check what's on hand, or try a different style or event!";
      }
      const productsWithImages = await Promise.all(products.map(resolveImage));
      setMessages((prev) => [
        ...prev,
        {
          sender: 'bot',
          text: linkifyItemNames(reply),
          products: productsWithImages,
          source: botResult.source,
          provider: botResult.provider,
          model: botResult.model,
        },
      ]);
      // Follow-up chips adapt to what was just asked about
      setSuggestions(nextSuggestions(userText, productsWithImages, botResult.source));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuggestionClick = (suggestion) => sendMessage(suggestion);
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleBook = (item) => {
    if (!onBook) return;
    onClose?.();
    onBook(item);
  };

  // Bottom-sheet shell (same as the transaction sheet): bottom-anchored on
  // mobile with swipe-down-to-close, centered card on desktop. The messages
  // list carries data-sheet-scroll so a downward drag mid-scroll stays a
  // scroll — only a drag from the top dismisses.
  return (
    <BottomSheet onClose={onClose} labelledby="dialog-title-ai-stylist" maxWidth="sm:max-w-md">
      <div className="h-[88dvh] sm:h-[90vh] sm:max-h-[680px] flex flex-col min-h-0 overflow-hidden">

        {/* Header */}
        <div className="relative px-5 py-4 bg-gradient-to-br from-[#8e323a] via-[#a63f47] to-[#bf4a53] shrink-0 overflow-hidden">
          <div className="absolute -right-8 -top-10 w-36 h-36 rounded-full bg-white/10" />
          <div className="absolute -right-2 top-10 w-20 h-20 rounded-full bg-white/5" />
          <div className="relative flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center text-white shadow-inner">
              <Sparkles size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 id="dialog-title-ai-stylist" className="font-bold text-white leading-tight">AI Stylist</h3>
              <p className="text-[11px] text-white/80 truncate">Mylene's Boutique · Balayan, Batangas</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 text-white text-[10px] font-bold">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-300" />
                </span>
                Online
              </span>
              <button onClick={onClose} aria-label="Close AI stylist" className="p-1.5 text-white/80 hover:bg-white/15 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
                <X size={18} />
              </button>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div data-sheet-scroll className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4 bg-gradient-to-b from-[#fdf7f5] to-[#f8f8f8] hide-scrollbar">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex items-end gap-2 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.sender === 'bot' && (
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#bf4a53] to-[#a63f47] flex items-center justify-center text-white shrink-0 shadow-sm shadow-[#bf4a53]/30">
                  <Sparkles size={12} />
                </div>
              )}
              <div
                className={`max-w-[82%] px-4 py-3 text-sm leading-relaxed ${
                  msg.sender === 'user'
                    ? 'bg-gradient-to-br from-[#bf4a53] to-[#a63f47] text-white rounded-2xl rounded-br-md shadow-md shadow-[#bf4a53]/25'
                    : 'bg-white border border-rose-100/80 text-gray-900 rounded-2xl rounded-bl-md shadow-sm'
                }`}
              >
                {msg.sender === 'bot' ? (
                  <>
                      <ReactMarkdown
                      components={{
                        p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                        ul: ({ children }) => <ul className="list-disc pl-4 mb-1">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal pl-4 mb-1">{children}</ol>,
                        a: renderLink,
                      }}
                    >
                      {msg.text}
                    </ReactMarkdown>

                    {/* Source indicator: shows whether the reply came from the AI
                        model, the built-in FAQ, or fell back to offline mode. */}
                    {msg.source && (
                      <div className="mt-2 flex items-center gap-1.5">
                        {msg.source === 'ai' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 text-[9px] font-bold">
                            <Sparkles size={9} /> AI · {shortModelName(msg.provider, msg.model)}
                          </span>
                        ) : msg.source === 'faq' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[9px] font-bold">
                            <Zap size={9} /> Instant Answer
                          </span>
                        ) : msg.source === 'error' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-[9px] font-bold">
                            <WifiOff size={9} /> Offline
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[9px] font-bold">
                            <Sparkles size={9} /> Assistant
                          </span>
                        )}
                      </div>
                    )}

                    {msg.products?.length > 0 && (
                      <div className="mt-3 grid grid-cols-2 gap-2.5">
                        {msg.products.map((item) => {
                          const sale = getSaleInfo(item);
                          const displayPrice = sale.active ? sale.price : item.price;
                          const originalPrice = sale.active ? item.price : null;
                          return (
                            <div
                              key={item.id}
                              className="group bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all flex flex-col"
                            >
                              <div className="relative h-24 overflow-hidden bg-gray-100">
                                {item.image ? (
                                  <img src={item.image} alt={item.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-gray-300">
                                    <ShoppingBag size={20} />
                                  </div>
                                )}
                                {sale.active && (
                                  <span className="absolute top-1.5 left-1.5 bg-[#bf4a53] text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md shadow-sm">
                                    SALE
                                  </span>
                                )}
                              </div>
                              <div className="p-2.5 flex-1 flex flex-col">
                                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">{item.category}</p>
                                <p className="text-[11px] font-bold text-gray-900 leading-tight truncate mt-0.5">{item.name}</p>
                                {sale.active ? (
                                  <div className="flex items-center gap-1.5 mt-0.5">
                                    <span className="text-[11px] font-bold text-[#bf4a53]">₱{Number(displayPrice || 0).toLocaleString()}</span>
                                    <span className="text-[10px] text-gray-400 line-through">₱{Number(originalPrice || 0).toLocaleString()}</span>
                                  </div>
                                ) : (
                                  <p className="text-[11px] text-gray-600 font-semibold mt-0.5">₱{Number(item.price || 0).toLocaleString()}</p>
                                )}
                                {onBook && (
                                  <button
                                    onClick={() => handleBook(item)}
                                    className="mt-2 w-full py-1.5 rounded-full text-[10px] font-bold bg-gradient-to-r from-[#bf4a53] to-[#a63f47] text-white hover:brightness-110 active:scale-[0.98] transition-all shadow-sm shadow-[#bf4a53]/25"
                                  >
                                    Book Now
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                ) : (
                  msg.text
                )}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex items-end gap-2 justify-start">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#bf4a53] to-[#a63f47] flex items-center justify-center text-white shrink-0 shadow-sm shadow-[#bf4a53]/30">
                <Sparkles size={12} />
              </div>
              <div className="bg-white border border-rose-100/80 rounded-2xl rounded-bl-md px-4 py-3.5 shadow-sm flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#bf4a53]/50 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-[#bf4a53]/50 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-[#bf4a53]/50 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Suggestions - dynamic based on conversation state */}
        <div className="px-4 py-2.5 flex gap-2 overflow-x-auto bg-white border-t border-gray-100 hide-scrollbar shrink-0">
          {suggestions.map((suggestion) => {
            const Icon = chipIcon(suggestion);
            return (
              <button
                key={suggestion}
                onClick={() => handleSuggestionClick(suggestion)}
                disabled={isLoading}
                className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold bg-rose-50 text-[#a63f47] border border-rose-100 hover:bg-rose-100 hover:border-rose-200 transition-colors disabled:opacity-50"
              >
                <Icon size={13} />
                {suggestion}
              </button>
            );
          })}
        </div>

        {/* Input */}
        <div className="px-4 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-white border-t border-gray-100 shrink-0">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe your event or ask anything…"
              disabled={isLoading}
              className="flex-1 px-4 py-2.5 bg-gray-100/80 border border-transparent rounded-full text-sm placeholder-gray-400 focus:outline-none focus:bg-white focus:border-[#bf4a53]/60 disabled:opacity-50 transition-colors"
            />
            <button
              type="button"
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || isLoading}
              aria-label="Send message"
              title={input.trim() ? 'Send' : 'Type a message first'}
              className="group w-11 h-11 shrink-0 rounded-full bg-gradient-to-br from-[#bf4a53] to-[#8e323a] text-white flex items-center justify-center shadow-md shadow-[#bf4a53]/30 transition-all duration-200 hover:shadow-lg hover:shadow-[#bf4a53]/45 hover:brightness-[1.08] active:scale-90 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none disabled:hover:brightness-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60"
            >
              {isLoading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Send size={18} className="transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              )}
            </button>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-gray-400">
            AI-generated replies can make mistakes — confirm details with our staff.
          </p>
        </div>
      </div>
    </BottomSheet>
  );
}
