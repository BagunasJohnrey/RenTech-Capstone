import { ScrollText, ArrowLeft, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { TERMS_SECTIONS } from '../components/TermsContent';

// Public /terms page — standalone Terms of Service view. Renders the exact
// TERMS_SECTIONS text (single source of truth in TermsContent.jsx) so the
// signup modal, Help Guide, and this page never drift apart. Mirrors
// PrivacyPolicyView's layout (public, signed-out reachable).
export default function TermsOfServiceView() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#FAFAFB] selection:bg-[#bf4a53]/10 selection:text-[#bf4a53]">
      {/* Nav */}
      <header className="sticky top-0 z-40 bg-[#FAFAFB]/80 backdrop-blur-lg border-b border-gray-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 md:py-4 flex items-center justify-between">
          <button onClick={() => navigate('/')} className="flex items-center gap-2 font-extrabold tracking-tighter text-gray-950">
            <img src="/RenTech.png" alt="RENTECH" className="w-8 h-8 object-contain rounded-xl" />
            <span className="hidden sm:block">RENTECH<span className="text-[#bf4a53]">.</span></span>
          </button>
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-1.5 text-xs md:text-sm font-semibold text-gray-600 px-3 py-2 hover:text-gray-950 transition-colors"
          >
            <ArrowLeft size={14} /> Back to Home
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 md:py-16">
        <div className="text-center mb-8 md:mb-12">
          <div className="w-14 h-14 bg-[#FAF0F1] rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ScrollText className="text-[#bf4a53]" size={28} />
          </div>
          <p className="text-[11px] md:text-xs font-bold text-[#bf4a53] uppercase tracking-[0.2em] mb-2">RenTech — Mylene's Boutique</p>
          <h1 className="text-3xl md:text-4xl font-extrabold text-gray-950 tracking-tighter leading-tight">Terms of Service</h1>
          <p className="text-gray-500 mt-3 text-sm md:text-base font-medium">
            The rules for using RenTech — bookings, payments, rentals, and your rights.
          </p>
        </div>

        <div className="space-y-4">
          {TERMS_SECTIONS.map((s) => (
            <div
              key={s.id}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 md:p-7"
            >
              <h2 className="font-bold text-gray-900 text-base md:text-lg mb-2">
                {s.title}
              </h2>
              {s.paragraphs?.map((p, i) => (
                <p key={i} className="text-sm md:text-[15px] text-gray-600 leading-relaxed">{p}</p>
              ))}
              {s.bullets && (
                <ul className="space-y-2 mt-3">
                  {s.bullets.map((b, i) => (
                    <li key={i} className="text-sm md:text-[15px] text-gray-600 leading-relaxed flex gap-2.5">
                      <span className="shrink-0 mt-2 w-1.5 h-1.5 rounded-full bg-[#bf4a53] inline-block" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              )}
              {s.closingParagraphs?.map((p, i) => (
                <p key={i} className="text-sm md:text-[15px] text-gray-600 leading-relaxed mt-2">{p}</p>
              ))}
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-gray-400 font-medium mt-8 flex items-center justify-center gap-1.5">
          <ShieldCheck size={12} />
          Last updated: September 2026 · Mylene's Boutique, Balayan, Batangas, Philippines
        </p>
      </main>
    </div>
  );
}
