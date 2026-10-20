import { ShieldCheck, Lock, Database, Share2, Trash2, Mail, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// Public /privacy page — Google OAuth branding verification requires the app
// homepage to link a privacy policy hosted on the app's own domain (not a
// third-party doc). Reuses the exact policy text from TermsContent.jsx
// (section 14, Data Privacy Act notice) so the wording stays identical
// everywhere it appears.
export default function PrivacyPolicyView() {
  const navigate = useNavigate();

  const sections = [
    {
      icon: Database,
      title: 'Information We Collect',
      body: [
        'Mylene\'s Boutique respects your privacy and is committed to complying with the Data Privacy Act of 2012 (Republic Act No. 10173) and its Implementing Rules and Regulations. As a Data Controller, we collect and process only the personal information needed to provide the service.',
      ],
      bullets: [
        'Account and booking details: name, email address, phone number, delivery/pickup address, and item preferences — used to create your account, process bookings and payments, and communicate with you.',
        'Rental and transaction records: booking dates, payment status, rental history, and related notifications — used to manage your rentals and comply with store operations.',
        'Device and usage data: basic technical information used for security, performance, and troubleshooting of the platform.',
      ],
    },
    {
      icon: Share2,
      title: 'How We Use and Share Your Data',
      body: [
        'Your personal information is collected with your consent, used only for the purposes stated above, and is never sold to third parties. We share data with our payment review staff only to the extent needed to verify your static-QR payments, and with SMS gateways only to send booking and reminder messages you have opted into.',
      ],
    },
    {
      icon: Lock,
      title: 'Data Security',
      body: [
        'We implement reasonable physical, organizational, and technical security measures — including encrypted storage and access controls — to protect your information. Data is retained only as long as necessary for the purposes stated or as required by law, after which it is securely disposed of.',
      ],
    },
    {
      icon: Trash2,
      title: 'Your Rights Under RA 10173',
      body: [
        'Under RA 10173, you have the right to be informed, to access, to object, to correct, to delete, and to file a complaint regarding your personal data. You may exercise these rights, or withdraw your consent at any time, by contacting us at the details below.',
      ],
    },
    {
      icon: Mail,
      title: 'Contact Us',
      body: [
        'For questions about this Privacy Policy, to exercise your data privacy rights, or for any other concern, you may reach Mylene\'s Boutique at its physical store in Balayan, Batangas, Philippines, or through the contact channels provided in the app\'s Help Guide.',
      ],
    },
  ];

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
            <ShieldCheck className="text-[#bf4a53]" size={28} />
          </div>
          <p className="text-[11px] md:text-xs font-bold text-[#bf4a53] uppercase tracking-[0.2em] mb-2">RenTech — Mylene's Boutique</p>
          <h1 className="text-3xl md:text-4xl font-extrabold text-gray-950 tracking-tighter leading-tight">Privacy Policy</h1>
          <p className="text-gray-500 mt-3 text-sm md:text-base font-medium">
            How we collect, use, and protect your personal information.
          </p>
        </div>

        <div className="space-y-4">
          {sections.map((s) => (
            <div
              key={s.title}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 md:p-7"
            >
              <h2 className="font-bold text-gray-900 text-base md:text-lg mb-2 flex items-center gap-2.5">
                <span className="shrink-0 w-8 h-8 rounded-xl bg-[#FAF0F1] flex items-center justify-center text-[#bf4a53]">
                  <s.icon size={16} />
                </span>
                {s.title}
              </h2>
              {s.body.map((p, i) => (
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
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-gray-400 font-medium mt-8">
          Last updated: September 2026 · Mylene's Boutique, Balayan, Batangas, Philippines
        </p>
      </main>
    </div>
  );
}
