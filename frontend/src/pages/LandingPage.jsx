import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useScroll, useMotionValueEvent } from 'framer-motion';
import {
  ShoppingBag, ShieldCheck, ArrowRight,
  CalendarDays, MapPin, ChevronDown, Phone, Clock
} from 'lucide-react';
import ItemImage from '../components/ItemImage';
import { getSaleInfo } from '../components/ItemCard';

// --- Custom Styles (unchanged) ---
const customStyles = `
  body { background-color: #FAFAFB; color: #111827; }

  .custom-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
  .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
  .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #e5e7eb; border-radius: 20px; }
  .custom-scrollbar:hover::-webkit-scrollbar-thumb { background-color: #d1d5db; }
  
  .hide-scrollbar::-webkit-scrollbar { display: none; }
  .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

  html { scroll-behavior: smooth; }
`;

// --- Animation Variants (unchanged) ---
const fadeInUp = {
  hidden: { opacity: 0, y: 30 },
  visible: { 
    opacity: 1, 
    y: 0, 
    transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } 
  }
};

const blurFadeInUp = {
  hidden: { opacity: 0, y: 30, filter: "blur(12px)" },
  visible: { 
    opacity: 1, 
    y: 0, 
    filter: "blur(0px)",
    transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] } 
  }
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.15 },
  },
};

const hoverScale = { scale: 1.02, transition: { duration: 0.2, ease: "easeInOut" } };
const buttonPress = { scale: 0.97 };

// --- Sample Data (unchanged) ---
const galleryItems = [
  {
    id: 1,
    title: 'Emerald Silk Mermaid Evening Gown',
    category: 'Gowns',
    price: 'From ₱1,500 / day',
    img: 'https://www.misshow.com/cdn/shop/files/Elegant-Stunning-Off-the-Shoulder-Mermaid-Prom-Evening-Dresses-Ruffles-With-Split.jpg?v=1763109918'
  },
  {
    id: 2,
    title: 'Hand-Painted Maria Clara Ensembles',
    category: 'Filipiniana',
    price: 'From ₱1,500 / day',
    img: 'https://cmcbaronglv.com/cdn/shop/files/1_d5ba90b4-d664-40db-8bed-ef53a23792e5.png?v=1748915935&width=713'
  },
  {
    id: 3,
    title: 'Organza Barong with Geometric Patterns',
    category: 'Barong',
    price: 'From ₱1,500 / day',
    img: 'https://barongsrus.com/wp-content/uploads/2023/08/1070A_SMM.jpg'
  },
  {
    id: 4,
    title: 'Forest Green 3-Piece Wool Suit',
    category: 'Suits',
    price: 'From ₱1,500 / day',
    img: 'https://i.pinimg.com/1200x/77/49/8b/77498bef8f7d20fed02a499253c3beef.jpg'
  }
];

const faqs = [
  { q: "How does the online reservation work?", a: "You can browse our catalog, check date-specific availability, and secure your booking by paying a downpayment online. Physical pickup and return must be done at the boutique." },
  { q: "Do you offer door-to-door delivery?", a: "No. Our system follows a strictly in-store fulfillment model. All fittings, item pickups, and returns must be conducted personally at Mylene's Boutique in Balayan." },
  { q: "Do you offer wedding gowns?", a: "Our current catalog strictly caters to social events such as proms, debuts, and pageants. We expressly exclude wedding-related rentals and bridal packages." },
  { q: "What happens if I return the item late or damaged?", a: "Our automated system calculates late penalties and damage fees based on predefined business rules. You will be notified via SMS regarding your return deadlines to help you avoid these fees." }
];

// Fetch up to 4 available pieces from the PUBLIC catalog for the gallery
// (/api/catalog needs no auth, so logged-out guests get real boutique items
// with signed-URL photos via ItemImage). Falls back to the static
// `galleryItems` if the request fails or returns empty.
function useFeaturedItems(fallback) {
  const [items, setItems] = useState(null); // null = still loading
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const API_BASE = import.meta.env.VITE_API_URL || '/api';
    fetch(`${API_BASE}/catalog`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!active) return;
        const list = Array.isArray(data) ? data : [];
        const available = list
          .filter((i) => (i.effectiveStatus || i.status) === 'Available')
          .slice(0, 4)
          .map((i) => ({ id: i.id, title: i.name, category: i.category || 'Piece', _item: i }));
        setItems(available.length > 0 ? available : null);
      })
      .catch(() => {
        if (!active) return;
        setFailed(true);
      });
    return () => { active = false; };
  }, []);

  // While loading, show nothing (prevents flash). On error, use fallback.
  if (items && items.length) return { items };
  if (failed) return { items: fallback };
  return { items: [] };
}

// --- Sub-Components (unchanged) ---
const FeatureCard = ({ icon: Icon, title, description }) => (
  <motion.div
    variants={fadeInUp}
    whileHover={hoverScale}
    className="bg-white rounded-[24px] p-6 md:p-8 border border-gray-100 shadow-sm shadow-gray-950/5 group transition-all duration-300 hover:border-gray-200 hover:shadow-lg hover:shadow-gray-950/5"
  >
    <div className="w-12 h-12 md:w-14 md:h-14 bg-[#FAF0F1] text-[#bf4a53] rounded-2xl flex items-center justify-center mb-6 md:mb-7 group-hover:scale-110 group-hover:bg-[#bf4a53] group-hover:text-white transition-all duration-300">
      <Icon size={24} strokeWidth={1.5} className="md:w-7 md:h-7" />
    </div>
    <h3 className="text-xl md:text-2xl font-bold text-gray-950 mb-3 tracking-tight">{title}</h3>
    <p className="text-gray-600 leading-relaxed text-sm md:text-base font-medium">{description}</p>
  </motion.div>
);

// Gallery card: renders a real inventory item when `_item` is present, else the
// original static markup (title/img/price fields).
const GalleryCard = ({ item, onBrowse }) => {
  const isReal = !!item._item;
  const sale = isReal ? getSaleInfo(item._item) : null;
  const price = isReal ? sale.price : null;
  const hasSale = isReal && sale.active;

  return (
    <motion.button
      type="button"
      onClick={onBrowse}
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      whileHover={{ y: -6 }}
      whileTap={buttonPress}
      className="group relative rounded-2xl md:rounded-[28px] overflow-hidden bg-gray-100 aspect-[3/4] cursor-pointer shadow-sm hover:shadow-xl hover:shadow-gray-950/10 transition-shadow duration-300 text-left"
    >
      {isReal ? (
        <ItemImage image={item._item.image} alt={item.title} className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
      ) : (
        <img src={item.img} alt={item.title} className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-gray-950/85 via-gray-950/20 to-transparent transition-opacity duration-300 md:opacity-70 md:group-hover:opacity-100" />
      {/* Category chip */}
      <span className="absolute top-3 left-3 md:top-4 md:left-4 inline-flex items-center px-3 py-1 rounded-full bg-white/85 backdrop-blur-md text-gray-900 text-[10px] md:text-xs font-bold tracking-widest uppercase shadow-sm">
        {item.category}
      </span>
      {/* Sale badge */}
      {hasSale && (
        <span className="absolute top-3 right-3 md:top-4 md:right-4 inline-flex items-center px-3 py-1 rounded-full bg-[#bf4a53] text-white text-[10px] md:text-xs font-bold tracking-widest uppercase shadow-sm">
          On Sale
        </span>
      )}
      {/* Bottom copy — pinned flush to the card bottom; the rent pill is
          collapsed (takes no space) on desktop and expands on hover,
          pushing the title/price up. Touch devices have no hover, so the
          pill stays visible there. */}
      <div className="absolute inset-x-0 bottom-0 p-4 md:p-6 flex flex-col justify-end">
        <h3 className={`text-white text-sm md:text-lg font-bold leading-snug ${isReal ? 'line-clamp-2' : ''}`}>{item.title}</h3>
        <p className="mt-0.5 text-white/70 text-[11px] md:text-sm font-medium">
          {isReal ? (
            hasSale ? (
              <>
                <span className="line-through opacity-70 mr-1.5">From ₱{Number(item._item.price).toLocaleString()} / day</span>
                <span className="text-white font-semibold">₱{Number(price).toLocaleString()} / day</span>
              </>
            ) : (
              <>From ₱{Number(item._item.price).toLocaleString()} / day</>
            )
          ) : (
            item.price
          )}
        </p>
        <div className="grid transition-all duration-300 ease-out grid-rows-[1fr] opacity-100 md:grid-rows-[0fr] md:opacity-0 md:group-hover:grid-rows-[1fr] md:group-hover:opacity-100 md:group-focus-within:grid-rows-[1fr] md:group-focus-within:opacity-100">
          <div className="overflow-hidden">
            <span className="mt-2.5 inline-flex w-fit items-center gap-1.5 rounded-full bg-[#bf4a53] text-white text-[10px] md:text-xs font-bold px-3 py-1.5 md:-translate-y-1 md:group-hover:translate-y-0 transition-transform duration-300">
              {isReal ? 'Rent this piece' : 'Browse this piece'} <ArrowRight size={12} strokeWidth={2.5} />
            </span>
          </div>
        </div>
      </div>
    </motion.button>
  );
};

const FaqItem = ({ question, answer }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="border border-gray-200 rounded-2xl mb-4 overflow-hidden bg-white">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full text-left p-5 md:p-6 flex justify-between items-center font-bold text-base md:text-lg text-gray-950 hover:bg-gray-50 transition-colors"
      >
        <span className="pr-4">{question}</span>
        <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.3 }}>
          <ChevronDown className="text-gray-400 flex-shrink-0" />
        </motion.div>
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="px-5 md:px-6 pb-5 md:pb-6 text-gray-600 text-sm md:text-base font-medium leading-relaxed"
          >
            {answer}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// --- Main Component ---
export default function LandingPage({ onLogin, onBrowse, onViewFeatured }) {
  const [navHidden, setNavHidden] = useState(false);
  const { scrollY } = useScroll();
  const { items: featuredItems } = useFeaturedItems(galleryItems);

  useMotionValueEvent(scrollY, "change", (latest) => {
    const previous = scrollY.getPrevious();
    if (latest > previous && latest > 150) {
      setNavHidden(true);
    } else {
      setNavHidden(false);
    }
  });

  const navLinks = [
    { name: 'Collection', href: '#collection' },
    { name: 'How it Works', href: '#how-it-works' },
    { name: 'Location', href: '#location' },
    { name: 'FAQ', href: '#faq' }
  ];

  return (
    <>
      <style>{customStyles}</style>
      
      <div className="min-h-screen bg-[#FAFAFB] selection:bg-[#bf4a53]/10 selection:text-[#bf4a53] overflow-x-hidden">
        
        {/* ---------- Header / Nav ---------- */}
        <motion.header 
          variants={{
            visible: { y: 0, opacity: 1 },
            hidden: { y: "-100%", opacity: 0 }
          }}
          initial="visible"
          animate={navHidden ? "hidden" : "visible"}
          transition={{ duration: 0.35, ease: "easeInOut" }}
          className="fixed top-0 left-0 right-0 z-50 bg-[#FAFAFB]/80 backdrop-blur-lg border-b border-gray-100"
        >
          <nav className="max-w-7xl mx-auto px-4 sm:px-6 py-3 md:py-4 flex justify-between items-center">
            <div className="text-xl md:text-2xl font-extrabold tracking-tighter flex items-center gap-2 text-gray-950">
              <img 
                src="/RenTech.png" 
                alt="RENTECH Logo" 
                className="w-8 h-8 md:w-9 md:h-9 object-contain rounded-xl"
              />
              <span className="hidden sm:block">RENTECH</span><span className="hidden sm:block text-[#bf4a53]">.</span>
            </div>
            
            <div className="hidden lg:flex items-center gap-8 text-sm font-semibold text-gray-600">
              {navLinks.map(item => (
                <a key={item.name} href={item.href} className="hover:text-gray-950 transition-colors">
                  {item.name}
                </a>
              ))}
            </div>

            <div className="flex items-center gap-2 md:gap-3">
              <motion.button 
                whileHover={{ color: '#000' }} 
                onClick={onLogin}
                className="text-xs md:text-sm font-semibold text-gray-600 px-3 py-2 md:px-4"
              >
                Sign In
              </motion.button>
            </div>
          </nav>
        </motion.header>

        {/* ---------- Hero Section ---------- */}
        <section className="relative overflow-hidden px-4 sm:px-6 pt-32 pb-20 md:px-12 md:pt-48 md:pb-32 flex flex-col items-center justify-center min-h-[90vh]">
          <div className="absolute inset-0 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:32px_32px] opacity-40 z-0" />
          
          <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none flex justify-center items-center opacity-60 md:opacity-80">
            <div className="absolute w-[250px] md:w-[500px] h-[250px] md:h-[500px] bg-[#bf4a53]/20 rounded-full blur-[80px] md:blur-[120px] top-[10%] right-[-10%] md:right-[10%]" />
            <div className="absolute w-[300px] md:w-[600px] h-[300px] md:h-[600px] bg-orange-300/20 rounded-full blur-[80px] md:blur-[140px] bottom-[5%] left-[-10%] md:left-[5%]" />
            <div className="absolute w-[200px] md:w-[400px] h-[200px] md:h-[400px] bg-pink-300/20 rounded-full blur-[70px] md:blur-[100px] top-[40%] left-[20%] md:left-[35%]" />
          </div>

          <motion.div initial="hidden" animate="visible" variants={staggerContainer} className="max-w-6xl mx-auto relative z-10 text-center flex flex-col items-center w-full">
            <motion.h1 variants={blurFadeInUp} className="text-5xl sm:text-6xl md:text-8xl font-extrabold tracking-tighter leading-[1.05] md:leading-[0.95] text-gray-950 mb-6 md:mb-8">
              Rent the outfit, <br />
              <span className="text-[#bf4a53]">own the moment.</span>
            </motion.h1>
            
            <motion.p variants={fadeInUp} className="text-lg sm:text-xl md:text-2xl text-gray-700 max-w-2xl md:max-w-3xl mx-auto leading-relaxed font-medium mb-10 md:mb-12">
              Effortless rentals for proms, debuts, and social events. Access our curated collection of gowns, suits, and costumes without the commitment of buying.
            </motion.p>

            <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full sm:w-auto">
              <motion.button
                whileHover={{ scale: 1.03, y: -2 }}
                whileTap={buttonPress}
                onClick={onBrowse}
                className="w-full sm:w-auto bg-[#bf4a53] text-white px-8 py-4 md:px-10 md:py-5 rounded-full font-bold text-base md:text-lg shadow-lg shadow-[#bf4a53]/20 hover:bg-[#a63f47] transition-all flex items-center justify-center gap-2"
              >
                Browse Collection
                <ArrowRight size={20} strokeWidth={2.5} />
              </motion.button>
            </motion.div>
          </motion.div>
        </section>

        {/* ---------- Collection (Gallery) Section ---------- */}
        <motion.section id="collection" initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.1 }} variants={staggerContainer} className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 md:px-12 py-16 md:py-24 scroll-mt-20">
          <div className="absolute inset-0 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:32px_32px] opacity-30 -z-10 rounded-[40px]" />

          <motion.div variants={fadeInUp} className="text-center max-w-2xl mx-auto mb-10 md:mb-16">
            <h2 className="text-sm md:text-base font-bold text-[#bf4a53] uppercase tracking-[0.2em] mb-2 md:mb-4">Mylene's Catalog</h2>
            <p className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-gray-950 tracking-tighter leading-tight">Featured Pieces</p>
            <p className="text-gray-500 mt-4 md:mt-5 text-sm md:text-lg leading-relaxed font-medium">
              A curated edit of gowns, suits, Filipiniana and costumes — ready for proms, debuts, and every social event in between.
            </p>
          </motion.div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            {featuredItems.map((item) => (
              <GalleryCard key={item.id} item={item} onBrowse={() => onViewFeatured?.(item)} />
            ))}
          </div>

          <motion.div variants={fadeInUp} className="mt-10 md:mt-14 flex justify-center">
            <motion.button
              whileHover={{ scale: 1.03, y: -2 }}
              whileTap={buttonPress}
              onClick={onBrowse}
              className="bg-gray-950 text-white px-8 py-3.5 md:px-10 md:py-4 rounded-full font-bold text-sm md:text-base shadow-lg shadow-gray-950/10 hover:bg-gray-800 transition-colors inline-flex items-center gap-2"
            >
              View Full Collection <ArrowRight size={18} />
            </motion.button>
          </motion.div>
        </motion.section>

        {/* ---------- How it Works Section (unchanged) ---------- */}
        <motion.section id="how-it-works" initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.1 }} variants={staggerContainer} className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 md:px-12 py-16 md:py-24 scroll-mt-20">
          <motion.div variants={fadeInUp} className="text-center mb-12 md:mb-20 max-w-2xl mx-auto">
            <h2 className="text-sm md:text-base font-bold text-[#bf4a53] uppercase tracking-[0.2em] mb-2 md:mb-4">The Process</h2>
            <p className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-gray-950 tracking-tighter leading-tight">Rental made simple</p>
          </motion.div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-8">
            <FeatureCard icon={ShoppingBag} title="1. Browse & Check" description="Browse our digital catalog of gowns, suits, and costumes. Use our portal to check date-specific availability." />
            <FeatureCard icon={CalendarDays} title="2. Book Online" description="Secure your reservation with an online downpayment via our secure gateway. We'll send you an SMS confirmation." />
            <FeatureCard icon={ShieldCheck} title="3. In-Store Fulfillment" description="Visit Mylene's Boutique in Balayan for fitting, pickup, and return. We'll track condition history for quality assurance." />
          </div>
        </motion.section>

        {/* ---------- Location Section (unchanged) ---------- */}
        <motion.section id="location" initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.1 }} variants={staggerContainer} className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 md:px-12 py-16 md:py-24 border-t border-gray-200 scroll-mt-20">
          <motion.div variants={fadeInUp} className="text-center mb-10 md:mb-16 max-w-2xl mx-auto">
             <h2 className="text-sm md:text-base font-bold text-[#bf4a53] uppercase tracking-[0.2em] mb-2 md:mb-4">Our Location</h2>
             <p className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-gray-950 tracking-tighter leading-tight">Visit Mylene's Boutique</p>
          </motion.div>
          
          <motion.div variants={fadeInUp} className="p-6 md:p-10 rounded-[24px] md:rounded-[32px] bg-white border border-gray-100 shadow-sm flex flex-col lg:flex-row items-center justify-between text-center lg:text-left gap-8 md:gap-12">
            <div className="flex-1 w-full lg:w-auto flex flex-col items-center lg:items-start">
              <div className="w-16 h-16 bg-[#FAF0F1] rounded-2xl flex items-center justify-center mb-6">
                 <MapPin className="text-[#bf4a53]" size={32} />
              </div>
              <h3 className="text-2xl md:text-3xl font-bold text-gray-950 mb-3 md:mb-4">Balayan, Batangas</h3>
              <p className="text-gray-500 text-sm md:text-base font-medium max-w-md mx-auto lg:mx-0 mb-6 md:mb-8 leading-relaxed">
                23 Years of Legacy. All online reservations are fulfilled directly at our local boutique. Come in for your personal fitting and item pickups.
              </p>
              <a 
                href="https://www.google.com/maps/place/Balayan,+Batangas" 
                target="_blank" 
                rel="noopener noreferrer"
                className="w-full lg:w-auto bg-gray-950 text-white font-bold hover:bg-gray-800 px-8 py-4 rounded-full transition-colors whitespace-nowrap shadow-md hover:shadow-lg active:scale-95 duration-200 inline-block text-center"
              >
                Get Directions
              </a>
            </div>

            <div className="flex-1 w-full relative">
              <div className="w-full aspect-square sm:aspect-video lg:aspect-square overflow-hidden rounded-[20px] bg-gray-100 shadow-inner border border-gray-200">
                <iframe 
                  src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d61905.74830303884!2d120.69742469446487!3d13.943034932314545!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x33bd96eb0092c48d%3A0xc3f8da08f579ce0a!2sBalayan%2C%20Batangas!5e0!3m2!1sen!2sph!4v1700000000000!5m2!1sen!2sph" 
                  className="w-full h-full border-0"
                  allowFullScreen="" 
                  loading="lazy" 
                  referrerPolicy="no-referrer-when-downgrade"
                  title="Mylene's Boutique Location Map"
                ></iframe>
              </div>
            </div>
          </motion.div>
        </motion.section>

        {/* ---------- FAQ Section (unchanged) ---------- */}
        <motion.section id="faq" initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.1 }} variants={staggerContainer} className="relative z-10 max-w-3xl mx-auto px-4 sm:px-6 md:px-12 py-16 md:py-24 scroll-mt-20">
           <motion.div variants={fadeInUp} className="text-center mb-10 md:mb-16">
             <h2 className="text-sm md:text-base font-bold text-[#bf4a53] uppercase tracking-[0.2em] mb-2 md:mb-4">Got Questions?</h2>
             <p className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-gray-950 tracking-tighter leading-tight">Frequently Asked Questions</p>
          </motion.div>
          <motion.div variants={fadeInUp}>
            {faqs.map((faq, index) => (
              <FaqItem key={index} question={faq.q} answer={faq.a} />
            ))}
          </motion.div>
        </motion.section>

        {/* ---------- Footer ---------- */}
        <footer className="border-t border-gray-200 bg-white pt-14 md:pt-20 pb-8 px-4 sm:px-6">
          <div className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 md:gap-12 text-gray-600 font-medium">
            {/* Brand */}
            <div>
               <div className="text-xl md:text-2xl font-extrabold tracking-tighter flex items-center gap-2 text-gray-950 mb-4">
                  <img
                    src="/RenTech.png"
                    alt="Mylene's Boutique Logo"
                    className="w-8 h-8 md:w-9 md:h-9 object-contain rounded-lg"
                  />
                  Mylene's Boutique
               </div>
               <p className="text-sm leading-relaxed text-gray-500">
                  23 years of legacy in Balayan, Batangas. Effortless rentals of gowns, suits, Filipiniana and costumes for proms, debuts, and every social event.
               </p>
            </div>

            {/* Explore */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-[0.15em] text-gray-950 mb-4">Explore</h4>
              <ul className="space-y-3 text-sm">
                <li><a href="#collection" className="hover:text-[#bf4a53] transition-colors">Collection</a></li>
                <li><a href="#how-it-works" className="hover:text-[#bf4a53] transition-colors">How it Works</a></li>
                <li><a href="#location" className="hover:text-[#bf4a53] transition-colors">Location</a></li>
                <li><a href="#faq" className="hover:text-[#bf4a53] transition-colors">FAQ</a></li>
                <li><a href="/privacy" className="hover:text-[#bf4a53] transition-colors">Privacy Policy</a></li>
                <li><a href="/terms" className="hover:text-[#bf4a53] transition-colors">Terms of Service</a></li>
              </ul>
            </div>

            {/* Visit Us */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-[0.15em] text-gray-950 mb-4">Visit Us</h4>
              <ul className="space-y-3 text-sm">
                <li className="flex items-start gap-2">
                  <MapPin size={16} className="text-[#bf4a53] mt-0.5 shrink-0" />
                  <span>Balayan, Batangas, Philippines</span>
                </li>
                <li className="flex items-start gap-2">
                  <Clock size={16} className="text-[#bf4a53] mt-0.5 shrink-0" />
                  <span>Mon – Sat, 9:00 AM – 6:00 PM</span>
                </li>
                <li>
                  <a
                    href="https://www.google.com/maps/place/Balayan,+Batangas"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-[#bf4a53] font-semibold hover:underline"
                  >
                    Get Directions <ArrowRight size={14} strokeWidth={2.5} />
                  </a>
                </li>
              </ul>
            </div>

            {/* Contact */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-[0.15em] text-gray-950 mb-4">Contact</h4>
              <ul className="space-y-3 text-sm">
                <li className="flex items-start gap-2">
                  <Phone size={16} className="text-[#bf4a53] mt-0.5 shrink-0" />
                  <span>In-store inquiries &amp; fittings</span>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={onLogin}
                    className="inline-flex items-center gap-1.5 text-[#bf4a53] font-semibold hover:underline"
                  >
                    Book an appointment <ArrowRight size={14} strokeWidth={2.5} />
                  </button>
                </li>
              </ul>
            </div>
          </div>

          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 mt-12 pt-6 md:pt-8 border-t border-gray-100 text-xs md:text-sm text-gray-500 font-medium">
            <p>© {new Date().getFullYear()} Mylene's Boutique. All rights reserved.</p>
            <p>Online reservation &amp; rental portal — Balayan, Batangas</p>
          </div>
        </footer>
      </div>
    </>
  );
}
