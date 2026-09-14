import { useState, useCallback } from 'react';
import { X, Sparkles, Download, Loader2, AlertCircle } from 'lucide-react';
import { parseReportSections } from '../utils/formatReport';
import { generateReportPdf } from '../utils/reportPdf';
import { useEscapeClose } from '../hooks/useEscapeClose';

const COMPANY = "Mylene's Boutique";
const TAGLINE = 'Rental Attire & Formal Wear';
const ADDRESS = 'Balayan, Batangas, Philippines';
const ACCENT = '#bf4a53';

export default function AIReportModal({ geminiReport, onClose }) {
  const sections = geminiReport ? parseReportSections(geminiReport) : [];
  const generatedDate = new Date().toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const docRef = `MB-RPT-${new Date().getFullYear()}-${String(
    new Date().getMonth() + 1
  ).padStart(2, '0')}`;

  const [downloading, setDownloading] = useState(false);
  // Timed exit like the other sheets: play the fade/slide-out, then unmount.
  const [closing, setClosing] = useState(false);
  const requestClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, 150);
  }, [closing, onClose]);
  useEscapeClose(requestClose);
  const handleDownloadPdf = () => {
    try {
      setDownloading(true);
      generateReportPdf(sections, { generatedDate, docRef });
    } catch (err) {
      console.error('PDF generation failed', err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-[100] transition-opacity duration-150 ${closing ? 'opacity-0' : 'opacity-100'}`}
    >
      <div className={`fixed inset-0 bg-gray-900/40 backdrop-blur-sm ${closing ? 'animate-out fade-out duration-150' : 'animate-in fade-in duration-200'}`} onClick={requestClose} />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center px-0 pt-10 pb-0 sm:p-4 pointer-events-none">
      <div
        className={`bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-3xl max-h-[92dvh] sm:max-h-[90vh] overflow-hidden flex flex-col pointer-events-auto transform-gpu ${closing ? 'animate-out slide-out-to-bottom sm:zoom-out-95 fade-out duration-150' : 'animate-in slide-in-from-bottom sm:zoom-in-95 duration-200'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* On-screen modal header (not printed) */}
        <div className="shrink-0 flex justify-between items-center gap-3 px-4 sm:px-5 py-3.5 sm:py-4 border-b border-gray-100/80 bg-gradient-to-r from-red-50 to-white no-print">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-xl text-white shrink-0" style={{ backgroundColor: ACCENT }}>
              <Sparkles size={17} />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-[15px] sm:text-lg text-gray-900 leading-tight truncate">AI Business Report</h3>
              <p className="text-[11px] sm:text-xs text-gray-500 truncate">Powered by Gemini · Real-time analytics</p>
            </div>
          </div>
          <button
            onClick={requestClose}
            aria-label="Close report"
            className="text-gray-400 hover:bg-gray-200 p-2 rounded-full transition-colors shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable report body */}
        <div className="overflow-y-auto overscroll-contain flex-1 min-h-0 custom-scrollbar bg-gray-50/40">
          {!geminiReport ? (
            <div className="flex flex-col items-center justify-center py-20 px-6 text-center space-y-3">
              <AlertCircle size={32} className="text-gray-300" />
              <p className="text-sm text-gray-500">AI report could not be generated. Please try again.</p>
            </div>
          ) : (
            <div id="report-print-area" className="report-document report-document-screen bg-white mx-3 my-3 sm:mx-auto sm:my-6 max-w-[780px] shadow-none sm:shadow-sm rounded-2xl sm:rounded-xl overflow-hidden">
              {/* Business letterhead — stacks on mobile */}
              <header className="report-header" style={{ borderTopColor: ACCENT }}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <h1 className="report-company" style={{ color: ACCENT }}>{COMPANY}</h1>
                    <p className="report-tagline">{TAGLINE}</p>
                    <p className="report-address">{ADDRESS}</p>
                  </div>
                  <div className="sm:text-right shrink-0 border-t border-gray-100 pt-3 sm:border-0 sm:pt-0">
                    <p className="report-doc-title">Business Performance Report</p>
                    <p className="report-meta">Date: {generatedDate}</p>
                    <p className="report-meta">Ref: {docRef}</p>
                  </div>
                </div>
                <hr className="report-rule" style={{ borderColor: ACCENT }} />
              </header>

              {/* Sections */}
              <div className="report-body">
                {sections.map((section, idx) => (
                  <section key={idx} className="report-section">
                    {section.title && (
                      <h2 className="report-section-title" style={{ color: ACCENT }}>
                        {section.title}
                      </h2>
                    )}
                    <div className="report-section-content">
                      {section.bodyLines.map((line, i) => (
                        <p key={i} className="report-line">
                          {line}
                        </p>
                      ))}
                    </div>
                  </section>
                ))}
              </div>

              {/* Footer */}
              <footer className="report-footer">
                <p>
                  Generated by {COMPANY} AI Analytics · This report is confidential and intended for
                  management use only.
                </p>
              </footer>
            </div>
          )}
        </div>

        {/* On-screen footer actions (not printed) */}
        <div className="shrink-0 px-4 sm:px-5 py-3.5 sm:py-4 border-t border-gray-100/80 bg-gray-50/50 flex items-center gap-3 no-print">
          <p className="hidden sm:block text-xs text-gray-400 flex-1">Generated by Gemini (server)</p>
          <button
            onClick={handleDownloadPdf}
            disabled={!geminiReport || downloading}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-5 py-2.5 text-xs font-bold text-white rounded-xl sm:rounded-full transition-all active:scale-[0.98] disabled:opacity-50"
            style={{ backgroundColor: ACCENT }}
          >
            {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {downloading ? 'Generating…' : 'Download PDF'}
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
