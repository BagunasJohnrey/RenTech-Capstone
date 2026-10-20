import { ShieldCheck, ScrollText } from 'lucide-react';

// Single source of truth for the Terms & Conditions and Privacy Policy — used
// by the signup agreement modal (Login.jsx) and the full Help Guide section
// (HelpGuide.jsx) so both always show the same text.
export const TERMS_SECTIONS = [
  {
    id: 'acceptance',
    title: '1. Acceptance of Terms',
    paragraphs: [
      'By creating an account, accessing, or using the RenTech platform ("the Service") operated for Mylene\'s Boutique, a rental boutique based in Balayan, Batangas, you agree to be bound by these Terms and Conditions and our Privacy Policy. If you do not agree with any part of these terms, please do not create an account or use the Service.',
    ],
  },
  {
    id: 'service',
    title: '2. About the Service',
    paragraphs: [
      'RenTech is a rental management and booking platform that allows customers to browse the boutique\'s inventory of gowns, suits, barongs, Filipiniana, costumes, and other formal wear, check availability, book items for rental, and pay deposits online. The platform also provides staff and administrators with tools to manage inventory, bookings, returns, notifications, reports, and an AI-powered styling assistant.',
    ],
  },
  {
    id: 'accounts',
    title: '3. Accounts, Registration & Security',
    paragraphs: [
      'You must provide accurate, current, and complete information when creating an account. You are responsible for safeguarding your password and for all activity that occurs under your account. Notify the boutique immediately of any unauthorized use. You must be at least 18 years old, or have the consent of a parent or guardian, to create an account.',
    ],
  },
  {
    id: 'booking',
    title: '4. Booking, Downpayment & Payment',
    paragraphs: [
      'A booking is confirmed only when the required downpayment (minimum ₱200) is received and a confirmation is issued by the platform. The remaining balance is payable at pickup — the item is released only once fully paid, via cash or our static-QR online payment. Promotional codes, sale prices, and fees shown at checkout are final at the time of booking. In the event of a pricing error, the boutique reserves the right to correct it before the rental is handed over.',
    ],
  },
  {
    id: 'pickup-return',
    title: '5. Pickup, Return & Late Returns',
    paragraphs: [
      'Items must be picked up before the scheduled event date and returned the day after the event, unless otherwise agreed. Items are due at the boutique in Balayan, Batangas. Returns are accepted only when the balance is fully paid; any damage fee assessed at return may leave a new balance, which remains payable after the item is back. Rentals that are not returned on time are considered overdue; the boutique may send reminders and escalate the matter until the item is returned.',
    ],
  },
  {
    id: 'care',
    title: '6. Care & Condition of Rented Items',
    paragraphs: [
      'You are responsible for the rented item(s) from pickup until return. Items must be kept clean, handled with care, and returned in the same condition they were received, except for normal wear. Damage, loss, or theft beyond normal wear — including but not limited to stains, rips, burns, missing accessories, or alterations — will be charged to you based on the boutique\'s assessment. Altering, cleaning, or re-dyeing a rented item without written permission is prohibited.',
    ],
  },
  {
    id: 'cancellation',
    title: '7. Cancellations & Rescheduling',
    paragraphs: [
      'Cancellations and rescheduling requests are handled by the boutique. Downpayment refunds, if any, follow the store\'s cancellation policy in effect at the time of booking. No-shows after the scheduled pickup may result in cancellation of the booking and forfeiture of the downpayment.',
    ],
  },
  {
    id: 'use',
    title: '8. Acceptable Use of the Website',
    paragraphs: [
      'You agree not to misuse the Service: you may not attempt to interfere with, reverse-engineer, or gain unauthorized access to any part of the platform, its servers, or other users\' accounts. You may not use the Service for any unlawful purpose, to misrepresent your identity, or to submit false booking information. We reserve the right to suspend or terminate accounts that violate these terms.',
    ],
  },
  {
    id: 'ai',
    title: '9. AI Stylist Disclaimer',
    paragraphs: [
      'The AI stylist is an automated assistant that provides suggestions and information based on the boutique\'s live inventory and general styling knowledge. Recommendations are informational only and do not constitute professional fashion or legal advice. Availability, pricing, and fit details shown should always be confirmed with the boutique before booking. The boutique is not liable for decisions made based on AI-generated suggestions.',
    ],
  },
  {
    id: 'ip',
    title: '10. Intellectual Property',
    paragraphs: [
      'The RenTech name, logo, website design, and all content provided through the Service — including text, graphics, photos of inventory, and software — are the property of Mylene\'s Boutique and its licensors. You may not copy, reproduce, distribute, or create derivative works without prior written permission.',
    ],
  },
  {
    id: 'liability',
    title: '11. Limitation of Liability',
    paragraphs: [
      'To the maximum extent permitted by law, Mylene\'s Boutique shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the Service, including missed events, lost opportunities, or data loss. Our total liability in connection with the Service shall not exceed the amounts you paid for the rental(s) in question.',
    ],
  },
  {
    id: 'changes',
    title: '12. Changes to These Terms',
    paragraphs: [
      'We may update these Terms and Conditions from time to time. Material changes will be posted on this page. Continued use of the Service after changes take effect constitutes acceptance of the revised terms.',
    ],
  },
  {
    id: 'law',
    title: '13. Governing Law',
    paragraphs: [
      'These terms are governed by and construed in accordance with the laws of the Republic of the Philippines. Any disputes arising out of or in connection with the Service shall be subject to the exclusive jurisdiction of the courts of Balayan, Batangas, Philippines.',
    ],
  },
  {
    id: 'privacy',
    title: '14. Privacy Policy & the Data Privacy Act of 2012 (RA 10173)',
    paragraphs: [
      'Mylene\'s Boutique respects your privacy and is committed to complying with the Data Privacy Act of 2012 (Republic Act No. 10173) and its Implementing Rules and Regulations. As a Data Controller, we collect and process only the personal information needed to provide the Service:',
    ],
    bullets: [
      'Account and booking details: name, email address, phone number, delivery/pickup address, and item preferences — used to create your account, process bookings and payments, and communicate with you.',
      'Rental and transaction records: booking dates, payment status, rental history, and related notifications — used to manage your rentals and comply with store operations.',
      'Device and usage data: basic technical information used for security, performance, and troubleshooting of the platform.',
    ],
    closingParagraphs: [
      'Your personal information is collected with your consent, used only for the purposes stated above, and is never sold to third parties. We share data with our payment review staff only to the extent needed to verify your static-QR payments, and with SMS gateways only to send booking and reminder messages you have opted into.',
      'We implement reasonable physical, organizational, and technical security measures — including encrypted storage and access controls — to protect your information. Data is retained only as long as necessary for the purposes stated or as required by law, after which it is securely disposed of.',
      'Under RA 10173, you have the right to be informed, to access, to object, to correct, to delete, and to file a complaint regarding your personal data. You may exercise these rights, or withdraw your consent at any time, by contacting us at the details below.',
    ],
  },
  {
    id: 'contact',
    title: '15. Contact Us',
    paragraphs: [
      'For questions about these Terms and Conditions or the Privacy Policy, to exercise your data privacy rights, or for any other concern, you may reach Mylene\'s Boutique at its physical store in Balayan, Batangas (please inquire with our staff for contact details) or through the contact channels provided in the Help Guide.',
    ],
  },
];

// Renders the full terms — reused by the Help Guide section and the signup
// modal so the text stays identical everywhere.
export default function TermsContent({ className = '' }) {
  return (
    <div className={className}>
      {TERMS_SECTIONS.map((section) => (
        <div key={section.id} className="mb-5">
          <h4 className="font-bold text-gray-900 text-sm mb-1.5">{section.title}</h4>
          {section.paragraphs?.map((p, i) => (
            <p key={i} className="text-sm text-gray-600 leading-relaxed mb-1.5">{p}</p>
          ))}
          {section.bullets && (
            <ul className="space-y-1.5 mb-1.5 mt-1.5">
              {section.bullets.map((b, i) => (
                <li key={i} className="text-sm text-gray-600 leading-relaxed flex gap-2">
                  <span className="text-[#bf4a53] shrink-0 mt-1.5 w-1 h-1 rounded-full bg-[#bf4a53] inline-block" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
          {section.closingParagraphs?.map((p, i) => (
            <p key={i} className="text-sm text-gray-600 leading-relaxed mb-1.5">{p}</p>
          ))}
        </div>
      ))}
    </div>
  );
}

// Small badge block used to open the terms (signup + help header).
export function TermsBadge({ label = 'Terms & Conditions', sub = 'Read our full terms, rental policies, and Data Privacy Act notice.' }) {
  return (
    <div className="flex items-start gap-3">
      <span className="shrink-0 w-10 h-10 rounded-2xl bg-[#bf4a53]/10 border border-[#bf4a53]/20 flex items-center justify-center text-[#bf4a53]">
        <ScrollText size={18} />
      </span>
      <div>
        <p className="font-bold text-gray-900 text-sm flex items-center gap-1.5">
          <ShieldCheck size={14} className="text-emerald-600" /> {label}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">{sub}</p>
      </div>
    </div>
  );
}
