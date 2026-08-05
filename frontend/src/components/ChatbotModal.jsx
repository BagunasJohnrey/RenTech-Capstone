import { useState, useRef, useEffect } from 'react';
import { X, Send, Sparkles, Loader2, ShoppingBag, Tag, ArrowRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { api } from '../utils/api';
import { storageService } from '../services';
import { imageCache } from '../utils/imageCache';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { getSaleInfo } from './ItemCard';

// Quick replies that appear after the greeting
const WELCOME_SUGGESTIONS = [
  'Find outfit for my event',
  'What sizes do you have?',
  'How much is rental?',
  'Store location & hours',
];

// General suggestions that appear after answers
const FOLLOW_UP_SUGGESTIONS = [
  'Show me more options',
  'What sizes do you have?',
  'How do I book?',
  'Check available items',
];

// Item images are stored as Supabase paths (private bucket), not URLs. Resolve
// a path to a short-lived signed URL; already-absolute URLs are used as-is.
const isAbsoluteUrl = (v) =>
  typeof v === 'string' && (v.startsWith('http://') || v.startsWith('https://') || v.startsWith('data:'));

async function resolveImage(item) {
  if (!item?.image || isAbsoluteUrl(item.image)) return item;
  try {
    const url = await imageCache.resolve(item.image, async () => {
      const res = await storageService.getDownloadUrl(item.image);
      return res?.url || null;
    });
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

// Scores inventory items against the customer's prompt and returns the best matches.
function findSuggestions(text, inventory) {
  if (!text || !inventory?.length) return [];
  const lower = text.toLowerCase();
  const words = lower.split(/\W+/).filter((w) => w.length >= 3);

  const targetCategories = new Set();
  for (const [keyword, cats] of Object.entries(EVENT_KEYWORDS)) {
    if (lower.includes(keyword)) cats.forEach((c) => targetCategories.add(c));
  }

  const scored = inventory
    .filter((i) => i.status === 'Available')
    .map((item) => {
      const name = (item.name || '').toLowerCase();
      const category = (item.category || '').toLowerCase();
      let score = 0;
      if (targetCategories.has(category)) score += 3;
      for (const w of words) {
        if (name.includes(w)) score += 2;
        if (category.includes(w)) score += 2;
      }
      return { item, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((s) => s.item);

  return scored;
}

// Only surface product suggestions when the prompt is actually about finding
// an outfit for an event — not for generic Q&A (hours, pricing, sizing…).
const STYLIST_INTENT = ['outfit', 'wear', 'recommend', 'suggest', 'look', 'attire', 'dress', 'clothing', 'style', 'fit'];
function isOutfitQuery(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  const triggers = [...Object.keys(EVENT_KEYWORDS), ...STYLIST_INTENT];
  return triggers.some((w) => lower.includes(w));
}

export default function ChatbotModal({ onClose, inventory = [], onBook }) {
  useEscapeClose(onClose);
  const [messages, setMessages] = useState([
    {
      sender: 'bot',
      text:
        "Hi! I'm your AI stylist for Mylene's Boutique in Balayan, Batangas. Tell me about your event (wedding, graduation, debut…) and I'll suggest outfits from our collection you can book right away.",
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState(WELCOME_SUGGESTIONS);
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
        history: chatHistoryRef.current,
      });
      chatHistoryRef.current = [
        ...chatHistoryRef.current,
        { role: 'user', text: userText },
        { role: 'model', text: result.reply },
      ];
      return result.reply;
    } catch (err) {
      if (err?.status === 429) {
        return err.body?.error || "You're sending messages too quickly. Please wait a moment and try again.";
      }
      return "I'm having trouble connecting. Try asking about booking, sizing, or gowns!";
    }
  };

  const sendMessage = async (userText) => {
    if (!userText.trim() || isLoading) return;

    const userMessage = { sender: 'user', text: userText };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const botText = await getResponse(userText);
      const products = isOutfitQuery(userText) ? findSuggestions(userText, inventory) : [];
      const productsWithImages = await Promise.all(products.map(resolveImage));
      let reply = botText;
      if (isOutfitQuery(userText) && products.length === 0) {
        reply += "\n\nI couldn't find any available items matching that right now. You're welcome to visit our physical store in Balayan, Batangas to check what's on hand, or try a different style or event!";
      }
      setMessages((prev) => [...prev, { sender: 'bot', text: reply, products: productsWithImages }]);
      // Update suggestions for follow-up questions
      setSuggestions(FOLLOW_UP_SUGGESTIONS);
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

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog" aria-modal="true" aria-labelledby="dialog-title-ai-stylist"
        className="bg-white rounded-3xl shadow-2xl w-full max-w-md h-[90vh] max-h-[600px] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100 bg-gradient-to-r from-red-50 to-white">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-[#bf4a53] rounded-xl text-white">
              <Sparkles size={18} />
            </div>
            <div>
              <h3 id="dialog-title-ai-stylist" className="font-bold text-gray-900">AI Stylist</h3>
              <p className="text-xs text-gray-500 flex items-center gap-1">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                Online
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close AI stylist" className="p-1 text-gray-400 hover:bg-gray-100 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60">
            <X size={20} />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/50 hide-scrollbar">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                  msg.sender === 'user'
                    ? 'bg-[#bf4a53] text-white rounded-br-md'
                    : 'bg-white border border-gray-200 text-gray-900 rounded-bl-md shadow-sm'
                }`}
              >
                {msg.sender === 'bot' ? (
                  <>
                    <ReactMarkdown
                      components={{
                        p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                        ul: ({ children }) => <ul className="list-disc pl-4 mb-1">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal pl-4 mb-1">{children}</ol>,
                      }}
                    >
                      {msg.text}
                    </ReactMarkdown>

                    {msg.products?.length > 0 && (
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {msg.products.map((item) => {
                          const sale = getSaleInfo(item);
                          const displayPrice = sale.active ? sale.effectivePrice : item.price;
                          const originalPrice = sale.active ? item.price : null;
                          return (
                            <div
                              key={item.id}
                              className="bg-gray-50 border border-gray-200 rounded-xl overflow-hidden flex flex-col"
                            >
                              {item.image ? (
                                <img src={item.image} alt={item.name} className="w-full h-24 object-cover bg-gray-100" />
                              ) : (
                                <div className="w-full h-24 bg-gray-100 flex items-center justify-center text-gray-300">
                                  <ShoppingBag size={20} />
                                </div>
                              )}
                              <div className="p-2 flex-1 flex flex-col">
                                <p className="text-[11px] font-bold text-gray-900 leading-tight truncate">{item.name}</p>
                                {sale.active ? (
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <span className="text-[11px] font-bold text-[#bf4a53]">₱{Number(displayPrice || 0).toLocaleString()}</span>
                                    <span className="text-[10px] text-gray-400 line-through">₱{Number(originalPrice || 0).toLocaleString()}</span>
                                    <span className="bg-[#bf4a53]/10 text-[#bf4a53] text-[9px] font-bold px-1.5 py-0.5 rounded">SALE</span>
                                  </div>
                                ) : (
                                  <p className="text-[10px] text-gray-500">₱{Number(item.price || 0).toLocaleString()}</p>
                                )}
                                {onBook && (
                                  <button
                                    onClick={() => handleBook(item)}
                                    className="mt-1.5 w-full py-1 rounded-full text-[10px] font-bold bg-[#bf4a53] text-white hover:bg-red-700 transition-colors"
                                  >
                                    Book
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
            <div className="flex justify-start">
              <div className="bg-white border border-gray-200 rounded-2xl px-4 py-2.5 flex items-center gap-2 text-gray-500">
                <Loader2 size={14} className="animate-spin" />
                <span className="text-xs">Thinking…</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Suggestions - dynamic based on conversation state */}
        <div className="px-4 py-2 flex gap-2 overflow-x-auto bg-white border-t border-gray-100">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              onClick={() => handleSuggestionClick(suggestion)}
              disabled={isLoading}
              className="whitespace-nowrap px-3 py-1.5 bg-gray-100 rounded-full text-xs font-medium hover:bg-gray-200 transition-colors disabled:opacity-50 flex items-center gap-1"
            >
              {suggestion}
              {suggestion === 'Find outfit for my event' && <ArrowRight size={12} />}
            </button>
          ))}
        </div>

        {/* Input */}
        <div className="p-4 border-t border-gray-100 bg-white flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe your event…"
            disabled={isLoading}
            className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-full text-sm focus:outline-none focus:border-[#bf4a53] disabled:opacity-50"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isLoading}
            aria-label="Send message"
            className="p-2.5 bg-[#bf4a53] text-white rounded-full hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60"
          >
            {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}
