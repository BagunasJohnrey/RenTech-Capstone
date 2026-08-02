import { useState } from 'react';
import { motion, AnimatePresence, useScroll, useMotionValueEvent } from 'framer-motion';
import { 
  Sparkles, ShoppingBag, ShieldCheck, ArrowRight, 
  CalendarDays, MapPin, ChevronDown 
} from 'lucide-react';

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
    img: 'https://www.misshow.com/cdn/shop/files/Elegant-Stunning-Off-the-Shoulder-Mermaid-Prom-Evening-Dresses-Ruffles-With-Split.jpg?v=1763109918'
  },
  {
    id: 2,
    title: 'Hand-Painted Maria Clara Ensembles',
    category: 'Filipiniana',
    img: 'https://cmcbaronglv.com/cdn/shop/files/1_d5ba90b4-d664-40db-8bed-ef53a23792e5.png?v=1748915935&width=713'
  },
  {
    id: 3,
    title: 'Organza Barong with Geometric Patterns',
    category: 'Barong',
    img: 'https://barongsrus.com/wp-content/uploads/2023/08/1070A_SMM.jpg'
  },
  {
    id: 4,
    title: 'Forest Green 3-Piece Wool Suit',
    category: 'Suits',
    img: 'https://i.pinimg.com/1200x/77/49/8b/77498bef8f7d20fed02a499253c3beef.jpg'
  }
];

const faqs = [
  { q: "How does the online reservation work?", a: "You can browse our catalog, check date-specific availability, and secure your booking by paying a downpayment online. Physical pickup and return must be done at the boutique." },
  { q: "Do you offer door-to-door delivery?", a: "No. Our system follows a strictly in-store fulfillment model. All fittings, item pickups, and returns must be conducted personally at Mylene's Boutique in Balayan." },
  { q: "Do you offer wedding gowns?", a: "Our current catalog strictly caters to social events such as proms, debuts, and pageants. We expressly exclude wedding-related rentals and bridal packages." },
  { q: "What happens if I return the item late or damaged?", a: "Our automated system calculates late penalties and damage fees based on predefined business rules. You will be notified via SMS regarding your return deadlines to help you avoid these fees." }
];

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
export default function LandingPage({ onLogin, onBrowse }) {
  const [navHidden, setNavHidden] = useState(false);
  const { scrollY } = useScroll();

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
              <motion.button 
                whileHover={hoverScale}
                whileTap={buttonPress}
                onClick={onBrowse}
                className="bg-gray-950 text-white px-4 py-2 md:px-5 md:py-2.5 rounded-full font-bold text-xs md:text-sm shadow-sm hover:bg-gray-800 transition-colors whitespace-nowrap"
              >
                Browse Now
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
            <motion.div variants={fadeInUp} className="inline-flex items-center gap-2 bg-white/60 backdrop-blur-md border border-gray-200 rounded-full px-4 py-2 text-xs md:text-sm font-semibold text-gray-700 mb-6 md:mb-8 shadow-sm">
              <Sparkles size={14} className="text-[#bf4a53]" />
              Powered by RenTech for Mylene's Boutique
            </motion.div>

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
          <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-8 md:mb-12 gap-4">
            <div>
              <h2 className="text-sm md:text-base font-bold text-[#bf4a53] uppercase tracking-[0.2em] mb-2 md:mb-4">Mylene's Catalog</h2>
              <p className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-gray-950 tracking-tighter">Featured Pieces</p>
            </div>
            <button onClick={onBrowse} className="hidden sm:flex items-center gap-2 text-gray-600 font-bold hover:text-[#bf4a53] transition-colors">
              View Full Collection <ArrowRight size={18} />
            </button>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            {galleryItems.map((item) => (
              <motion.div key={item.id} variants={fadeInUp} whileHover={{ y: -5 }} className="group relative rounded-2xl md:rounded-3xl overflow-hidden bg-gray-200 aspect-[3/4] cursor-pointer shadow-sm">
                <img src={item.img} alt={item.title} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                <div className="absolute inset-0 bg-gradient-to-t from-gray-950/80 via-transparent to-transparent opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-5 md:p-6">
                  <span className="text-white/80 text-xs md:text-sm font-bold tracking-widest uppercase mb-1">{item.category}</span>
                  <h3 className="text-white text-lg md:text-xl font-bold">{item.title}</h3>
                </div>
              </motion.div>
            ))}
          </div>
          <button onClick={onBrowse} className="sm:hidden w-full mt-6 flex items-center justify-center gap-2 bg-gray-100 text-gray-950 py-4 rounded-full font-bold">
            View Full Collection <ArrowRight size={18} />
          </button>
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

        {/* ---------- Footer (unchanged except logo) ---------- */}
        <footer className="border-t border-gray-200 bg-white py-10 md:py-12 px-4 sm:px-6">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6 text-gray-600 font-medium">
            <div className="text-center md:text-left">
               <div className="text-xl md:text-2xl font-extrabold tracking-tighter flex items-center justify-center md:justify-start gap-2 text-gray-950 mb-2">
                  <img 
                    src="/RenTech.png" 
                    alt="RENTECH Logo" 
                    className="w-7 h-7 md:w-8 md:h-8 object-contain rounded-lg"
                  />
                  RENTECH
               </div>
               <p className="text-xs md:text-sm leading-relaxed">Powered by AI Analytics for Mylene's Boutique.</p>
            </div>
            
            <div className="flex flex-wrap justify-center gap-4 md:gap-6 text-xs md:text-sm">
               <a href="#collection" className="hover:text-[#bf4a53] transition-colors">Collection</a>
               <a href="#how-it-works" className="hover:text-[#bf4a53] transition-colors">How it Works</a>
               <a href="#location" className="hover:text-[#bf4a53] transition-colors">Location</a>
            </div>
          </div>
          <div className="max-w-7xl mx-auto text-center mt-8 pt-6 md:pt-8 border-t border-gray-100 text-xs md:text-sm text-gray-500 font-medium">
            © {new Date().getFullYear()} Mylene's Boutique. All rights reserved. (Prototype Build)
          </div>
        </footer>
      </div>
    </>
  );
}
