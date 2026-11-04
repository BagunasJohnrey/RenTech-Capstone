import { useState } from 'react';
import { PhoneCall, Phone, CheckCircle2, ChevronDown } from 'lucide-react';
import Pagination from './ui/Pagination';
import { api } from '../utils/api';
import { customerLabel, customerPhone, customerTelLink, itemLabel } from '../utils/format';
import { peso } from '../utils/receipt';
import { useToast } from './Toast';
import BottomSheet from './BottomSheet';
import { rowActivation, ROW_FOCUS } from '../utils/a11y';

const NOTE_MAX = 500;
const PAGE_SIZE = 5;

// Rentals past the admin's `overdue_manual_call_days`: automatic SMS/email
// have stopped (client feedback §3.3) and a person needs to phone the
// customer. A rental leaves the list once someone marks it as called.
export const needsCall = (tx) =>
  !!tx?.manualCallPromptedAt && !tx?.manualCalledAt &&
  (tx.status === 'Overdue' || tx.status === 'Active');

const daysOverdue = (tx) => {
  const due = new Date(tx.dueDate || tx.date);
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(1, Math.round((today - due) / 86400000));
};

export default function NeedsCallCard({ transactions, onCalled, onOpen }) {
  const toast = useToast();
  const [calledIds, setCalledIds] = useState(() => new Set());
  const [marking, setMarking] = useState(null); // tx being marked
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const [urgentPage, setUrgentPage] = useState(1);
  const [noPhonePage, setNoPhonePage] = useState(1);
  const [showNoPhone, setShowNoPhone] = useState(false);

  const phoneOf = (tx) => customerPhone(tx.customerProfile ?? tx.customer, tx.customerPhone);
  const telOf = (tx) => customerTelLink(tx.customerProfile ?? tx.customer, tx.customerPhone);

  // Most urgent first: longest overdue, then the bigger unpaid balance.
  const rows = (transactions || [])
    .filter((tx) => needsCall(tx) && !calledIds.has(tx.id))
    .sort((a, b) => (daysOverdue(b) - daysOverdue(a)) || (Number(b.balance || 0) - Number(a.balance || 0)));

  // Rows staff can act on (a phone number to call) lead; the rest sit in a
  // collapsed group so a backlog of unreachable records can't bury them.
  const callable = rows.filter((tx) => telOf(tx));
  const noPhone = rows.filter((tx) => !telOf(tx));

  const pageCount = (list) => Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const urgentPageSafe = Math.min(urgentPage, pageCount(callable));
  const noPhonePageSafe = Math.min(noPhonePage, pageCount(noPhone));
  const pageOf = (list, page) => list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (rows.length === 0) return null;

  const closeSheet = () => { if (!saving) { setMarking(null); setNote(''); } };

  const submit = async () => {
    if (!marking) return;
    setSaving(true);
    try {
      await api.post(`/transactions/${marking.id}/manual-call`, { note: note.trim() || undefined });
      setCalledIds((prev) => new Set(prev).add(marking.id));
      toast.success(`Marked ${customerLabel(marking.customer)} as called.`);
      setMarking(null);
      setNote('');
      onCalled?.();
    } catch (err) {
      toast.error(err?.message || 'Could not save the call. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const renderRow = (tx) => {
    const tel = telOf(tx);
    const phone = phoneOf(tx);
    return (
            <li key={tx.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-3">
              <div
                {...rowActivation(onOpen ? () => onOpen(tx) : null)}
                className={`flex-1 min-w-0 rounded-lg ${onOpen ? `cursor-pointer ${ROW_FOCUS}` : ''}`}
                title={onOpen ? 'View details' : undefined}
              >
                <p className="text-sm font-bold text-gray-900 break-words">{customerLabel(tx.customer)}</p>
                <p className="text-[11px] text-gray-500 break-words">
                  {itemLabel(tx.item)} · <span className="font-semibold text-red-600">{daysOverdue(tx)} days overdue</span>
                  {Number(tx.balance) > 0 && <> · balance {peso(tx.balance)}</>}
                  {phone && <> · {phone}</>}
                </p>
              </div>
              <div className="flex gap-2 sm:shrink-0">
                {tel ? (
                  <a href={tel}
                    aria-label={`Call ${customerLabel(tx.customer)} at ${phone}`}
                    className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-full text-xs font-bold text-white bg-[#bf4a53] hover:bg-[#a83d46] transition-colors">
                    <Phone size={14} /> Call
                  </a>
                ) : (
                  <span className="inline-flex items-center min-h-[40px] px-3 text-xs font-semibold text-gray-400">No phone on file</span>
                )}
                <button type="button" onClick={() => setMarking(tx)}
                  className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-full text-xs font-bold text-gray-700 border border-gray-200 hover:bg-gray-50 transition-colors">
                  <CheckCircle2 size={14} /> Mark as called
                </button>
              </div>
            </li>
    );
  };

  return (
    <div className="bg-white rounded-3xl border border-red-100 shadow-sm p-5 lg:p-6">
      <div className="flex items-center gap-3 mb-1">
        <span className="w-10 h-10 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center shrink-0">
          <PhoneCall size={18} />
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-lg text-gray-900">Needs a call</h3>
          <p className="text-xs text-gray-500 font-medium">Automatic reminders have stopped for these rentals. Call the customer, then mark it done.</p>
        </div>
        <span className="text-xs font-bold text-red-700 bg-red-50 rounded-full px-2.5 py-1 shrink-0">{rows.length}</span>
      </div>

      {callable.length > 0 ? (
        <>
          <p className="mt-4 text-[11px] font-bold uppercase tracking-wide text-gray-400">
            Most urgent{callable.length > PAGE_SIZE ? ` · ${callable.length} to call` : ''}
          </p>
          <ul className="mt-1 divide-y divide-gray-100">
            {pageOf(callable, urgentPageSafe).map(renderRow)}
          </ul>
          <Pagination className="mt-3" page={urgentPageSafe} totalPages={pageCount(callable)}
            onPageChange={(p) => setUrgentPage(Math.min(Math.max(1, p), pageCount(callable)))} />
        </>
      ) : (
        <p className="mt-4 text-xs text-gray-500">No one on this list has a phone number on file.</p>
      )}

      {noPhone.length > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <button type="button" onClick={() => setShowNoPhone((v) => !v)} aria-expanded={showNoPhone}
            className="w-full flex items-center justify-between gap-2 min-h-[40px] text-xs font-bold text-gray-500 hover:text-gray-700 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/40">
            <span>No phone on file ({noPhone.length})</span>
            <ChevronDown size={16} className={`transition-transform ${showNoPhone ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
          {showNoPhone && (
            <>
              <ul className="divide-y divide-gray-100">
                {pageOf(noPhone, noPhonePageSafe).map(renderRow)}
              </ul>
              <Pagination className="mt-3" page={noPhonePageSafe} totalPages={pageCount(noPhone)}
                onPageChange={(p) => setNoPhonePage(Math.min(Math.max(1, p), pageCount(noPhone)))} />
            </>
          )}
        </div>
      )}

      {marking && (
        <BottomSheet onClose={closeSheet} labelledby="dialog-title-mark-called" z="z-[260]" maxWidth="sm:max-w-md" variant="dialog">
          <div className="p-6 space-y-4">
            <div>
              <h2 id="dialog-title-mark-called" className="text-lg font-bold text-gray-900">Mark as called</h2>
              <p className="text-xs text-gray-500 mt-1">{customerLabel(marking.customer)} · {itemLabel(marking.item)}</p>
            </div>
            <div>
              <label htmlFor="manual-call-note" className="text-xs font-bold text-gray-500 block mb-1.5">What did they say? (optional)</label>
              <textarea id="manual-call-note" rows={3} maxLength={NOTE_MAX} value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Will return on Friday"
                className="w-full p-3 bg-gray-50 rounded-xl border border-gray-200/80 text-sm focus:outline-none focus:bg-white focus:border-[#bf4a53] resize-none" />
              <p className="text-[11px] text-gray-400 text-right mt-1">{note.length}/{NOTE_MAX}</p>
              <p className="text-[11px] text-gray-400">Saved to the audit trail. Customers never see this note.</p>
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={closeSheet} disabled={saving}
                className="px-5 py-2 border border-gray-200 rounded-full text-sm font-bold hover:bg-gray-50 transition-colors disabled:opacity-50">Cancel</button>
              <button type="button" onClick={submit} disabled={saving}
                className="px-5 py-2 bg-[#bf4a53] text-white rounded-full text-sm font-bold hover:bg-red-700 transition-colors disabled:opacity-50">
                {saving ? 'Saving…' : 'Mark as called'}
              </button>
            </div>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}
