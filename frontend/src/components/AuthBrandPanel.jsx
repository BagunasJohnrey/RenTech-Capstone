import { Sparkles, ShoppingBag, ShieldCheck, Heart, MapPin } from 'lucide-react';

const FEATURES = [
  { icon: ShoppingBag, title: 'Curated collection', text: 'Gowns, suits, barongs and costumes' },
  { icon: Sparkles, title: 'AI styling tips', text: 'Outfit ideas for your occasion' },
  { icon: MapPin, title: 'Balayan, Batangas', text: 'Easy pickup and returns' },
  { icon: ShieldCheck, title: 'Secure bookings', text: 'Your account stays protected' },
];

// Left-hand brand panel shared by the sign-in / sign-up and Google
// sign-up-details screens (desktop only; phones go straight to the form).
// Pinned to the viewport height (sticky) so a long form — sign-up — doesn't
// stretch it; on very short screens it scrolls internally instead of clipping.
export default function AuthBrandPanel({ subtitle, showFeatures = true }) {
  return (
    <div className="hidden lg:flex lg:w-1/2 lg:self-start lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden relative isolate text-white bg-gradient-to-br from-[#c4505a] via-[#a93a43] to-[#7f242b]">
      {/* Decorative glow — clipped in its own layer so it never clips content. */}
      <div className="absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-32 -right-24 w-[28rem] h-[28rem] rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-40 -left-24 w-[30rem] h-[30rem] rounded-full bg-black/15 blur-3xl" />
      </div>

      <div className="flex flex-col w-full max-w-xl mx-auto px-10 xl:px-14 py-10 [@media(min-height:760px)]:py-14 gap-10">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-xl bg-white shadow-sm flex items-center justify-center shrink-0">
            <img src="/logo-128.webp" alt="" className="w-8 h-8" />
          </span>
          <span className="text-xl font-extrabold tracking-tight">RenTech</span>
        </div>

        <div className="my-auto">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/70">Mylene&rsquo;s Boutique rentals</p>
          <h1 className="mt-3 text-4xl xl:text-[2.75rem] font-extrabold leading-[1.1] tracking-tight [text-wrap:balance]">
            Your perfect outfit, one tap away.
          </h1>
          <p className="mt-4 text-white/80 text-base leading-relaxed max-w-md [text-wrap:pretty]">{subtitle}</p>

          {showFeatures && (
            <ul className="mt-8 grid grid-cols-1 xl:grid-cols-2 gap-3">
              {FEATURES.map(({ icon: Icon, title, text }) => (
                <li key={title} className="flex items-start gap-3 rounded-2xl bg-white/10 ring-1 ring-white/15 p-3.5 backdrop-blur-sm">
                  <span className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                    <Icon size={18} aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold leading-tight">{title}</span>
                    <span className="block mt-0.5 text-xs text-white/75 leading-snug">{text}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center gap-2 pt-6 border-t border-white/15 text-white/75 text-xs font-medium">
          <Heart size={14} className="shrink-0" aria-hidden="true" /> Loved by renters across Batangas
        </div>
      </div>
    </div>
  );
}
