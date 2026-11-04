import { useState, useEffect } from 'react';
import { CalendarClock, Mail, MessageSquare, Bell, PhoneCall, RotateCcw } from 'lucide-react';
import { api } from '../../utils/api';
import CollapsibleCard from './CollapsibleCard';
import Toggle from './Toggle';

// Admin reminder schedule (client feedback §3.2–3.4). Mirrors the backend
// NUMERIC_RULES defaults/ranges in settings.service.ts — the server
// re-validates every value on save.
const SCHEDULE_FIELDS = {
  leadDays: { key: 'due_reminder_lead_days', def: 0, min: 0, max: 7 },
  smsInterval: { key: 'overdue_sms_interval_days', def: 2, min: 1, max: 14 },
  smsMax: { key: 'overdue_sms_max_count', def: 3, min: 1, max: 30 },
  emailInterval: { key: 'overdue_email_interval_days', def: 2, min: 1, max: 14 },
  emailMax: { key: 'overdue_email_max_count', def: 3, min: 1, max: 30 },
  manualCallDays: { key: 'overdue_manual_call_days', def: 10, min: 2, max: 60 },
};

// Per-type email toggles (BusinessRule `email_type_<type>_enabled`, absent = on).
// Verification / password-reset emails are never switchable.
const EMAIL_TYPES = [
  { type: 'booking', label: 'Booking confirmation' },
  { type: 'pickup', label: 'Pickup receipt' },
  { type: 'return', label: 'Return receipt' },
  { type: 'cancellation', label: 'Cancellation' },
  { type: 'payment', label: 'Payment proof rejected' },
  { type: 'due_reminder', label: 'Due reminder' },
  { type: 'overdue', label: 'Overdue notices' },
];
const typeKey = (type) => `email_type_${type}_enabled`;

const DEFAULTS = Object.fromEntries(Object.entries(SCHEDULE_FIELDS).map(([k, f]) => [k, f.def]));
const sameSchedule = (a, b) => Object.keys(SCHEDULE_FIELDS).every((k) => a[k] === b[k]);

const clampRule = (raw, { def, min, max }) => {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const every = (n) => (n === 1 ? 'every day' : `every ${n} days`);

// Days overdue on which a channel sends, stopping before the call cutoff.
export function scheduleDays(interval, max, cutoff) {
  const days = [];
  for (let d = 1, i = 0; i < max && d < cutoff; i += 1, d += interval) days.push(d);
  return days;
}

// One row per day something happens — what the admin actually wants to see.
export function scheduleTimeline(s) {
  const events = [{
    sort: -s.leadDays,
    when: s.leadDays === 0 ? 'Due date' : s.leadDays === 1 ? '1 day before due' : `${s.leadDays} days before due`,
    what: 'Due reminder (SMS + email)',
    tone: 'due',
  }];
  const sms = new Set(scheduleDays(s.smsInterval, s.smsMax, s.manualCallDays));
  const email = new Set(scheduleDays(s.emailInterval, s.emailMax, s.manualCallDays));
  const days = [...new Set([...sms, ...email])].sort((a, b) => a - b);
  for (const d of days) {
    const parts = [sms.has(d) && 'SMS', email.has(d) && 'email'].filter(Boolean);
    events.push({ sort: d, when: `Day ${d} overdue`, what: `Overdue ${parts.join(' + ')}`, tone: 'overdue' });
  }
  events.push({
    sort: s.manualCallDays,
    when: `Day ${s.manualCallDays} overdue`,
    what: 'Reminders stop — staff call the customer',
    tone: 'call',
  });
  return events.sort((a, b) => a.sort - b.sort);
}

const TONES = {
  due: { dot: 'bg-amber-400', Icon: Bell, text: 'text-amber-700' },
  overdue: { dot: 'bg-[#bf4a53]', Icon: MessageSquare, text: 'text-[#bf4a53]' },
  call: { dot: 'bg-gray-900', Icon: PhoneCall, text: 'text-gray-900' },
};

// Vertical list on phones; a horizontal step strip on desktop (lg+).
function Timeline({ schedule }) {
  const events = scheduleTimeline(schedule);
  return (
    <ol className="relative space-y-3 pl-5 before:absolute before:left-[5px] before:top-1.5 before:bottom-1.5 before:w-px before:bg-gray-200
      lg:space-y-0 lg:pl-0 lg:before:hidden lg:grid lg:grid-flow-col lg:auto-cols-fr lg:gap-4">
      {events.map((e, i) => {
        const t = TONES[e.tone];
        const last = i === events.length - 1;
        return (
          <li key={`${e.when}-${e.what}`} className="relative lg:pt-6">
            <span className={`absolute -left-5 top-1.5 lg:left-0 lg:top-0 w-[11px] h-[11px] rounded-full ring-2 ring-white z-[1] ${t.dot}`} aria-hidden="true" />
            {!last && <span className="hidden lg:block absolute top-[5px] left-4 -right-4 h-px bg-gray-200" aria-hidden="true" />}
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">{e.when}</p>
            <p className={`text-sm font-semibold ${t.text}`}>{e.what}</p>
          </li>
        );
      })}
    </ol>
  );
}

// Compact inline number input: "[ 2 ] days". Clamps on blur so typing
// "1" on the way to "14" isn't snapped mid-keystroke.
function InlineNumber({ id, value, min, max, onChange, unit, label }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const commit = () => {
    let v = parseInt(text, 10);
    if (!Number.isFinite(v)) v = min;
    v = Math.min(Math.max(v, min), max);
    setText(String(v));
    onChange(v);
  };
  return (
    <span className="inline-flex items-center gap-2">
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={text}
        aria-label={label}
        onChange={(e) => {
          setText(e.target.value);
          const v = parseInt(e.target.value, 10);
          if (Number.isFinite(v) && v >= min && v <= max) onChange(v);
        }}
        onBlur={commit}
        className="w-16 h-10 bg-gray-50 rounded-xl border border-gray-200/80 text-sm text-center font-semibold focus:outline-none focus:bg-white focus:border-[#bf4a53]"
      />
      {unit && <span className="text-sm text-gray-600">{unit}</span>}
    </span>
  );
}

function Section({ icon: Icon, iconClass, title, hint, children }) {
  return (
    <div className="rounded-2xl border border-gray-100 p-4">
      <div className="flex items-center gap-2.5 mb-3">
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${iconClass}`}><Icon size={15} /></span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-900">{title}</p>
          {hint && <p className="text-[11px] text-gray-500 leading-snug">{hint}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">{children}</div>
    </div>
  );
}

function Field({ label, children, def }) {
  return (
    <div>
      <p className="text-[11px] font-bold text-gray-500 mb-1.5">{label}</p>
      {children}
      {def != null && <p className="text-[10px] text-gray-400 mt-1">Default: {def}</p>}
    </div>
  );
}

export default function ReminderScheduleCard() {
  const [saved, setSaved] = useState(DEFAULTS);
  const [draft, setDraft] = useState(DEFAULTS);
  const [types, setTypes] = useState(() => Object.fromEntries(EMAIL_TYPES.map(({ type }) => [type, true])));
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(undefined);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null); // { text, error }
  const [savingType, setSavingType] = useState(null);

  useEffect(() => {
    api.get('/settings/rules').then((rules) => {
      if (!rules) return;
      const next = {};
      for (const [k, f] of Object.entries(SCHEDULE_FIELDS)) next[k] = clampRule(rules[f.key], f);
      setSaved(next);
      setDraft(next);
      setTypes(Object.fromEntries(EMAIL_TYPES.map(({ type }) => [type, rules[typeKey(type)] !== 'false'])));
    }).catch(() => {});
  }, []);

  const flash = (text, error = false) => {
    setMsg({ text, error });
    setTimeout(() => setMsg(null), 3000);
  };

  const save = async () => {
    const body = {};
    for (const [k, f] of Object.entries(SCHEDULE_FIELDS)) body[f.key] = String(draft[k]);
    setSaving(true);
    try {
      await api.put('/settings/rules', body);
      setSaved(draft);
      setEditing(false);
      flash('Reminder schedule saved.');
    } catch (err) {
      flash(`Could not save: ${err?.message || 'server error'}`, true);
    } finally {
      setSaving(false);
    }
  };

  const toggleType = async (type) => {
    const nextOn = !types[type];
    setTypes((t) => ({ ...t, [type]: nextOn }));
    setSavingType(type);
    try {
      await api.put('/settings/rules', { [typeKey(type)]: String(nextOn) });
    } catch (err) {
      setTypes((t) => ({ ...t, [type]: !nextOn }));
      flash(`Could not save: ${err?.message || 'server error'}`, true);
    } finally {
      setSavingType(null);
    }
  };

  const resetEmailTypes = async () => {
    const body = Object.fromEntries(EMAIL_TYPES.map(({ type }) => [typeKey(type), 'true']));
    const prev = types;
    setTypes(Object.fromEntries(EMAIL_TYPES.map(({ type }) => [type, true])));
    try {
      await api.put('/settings/rules', body);
      flash('All customer emails turned back on.');
    } catch (err) {
      setTypes(prev);
      flash(`Could not save: ${err?.message || 'server error'}`, true);
    }
  };

  const set = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }));
  const num = (k, unit, label) => {
    const f = SCHEDULE_FIELDS[k];
    return <InlineNumber id={`rs-${k}`} value={draft[k]} min={f.min} max={f.max} unit={unit} label={label} onChange={set(k)} />;
  };

  const shown = editing ? draft : saved;
  const savedIsDefault = sameSchedule(saved, DEFAULTS);
  const draftIsDefault = sameSchedule(draft, DEFAULTS);
  const dirty = !sameSchedule(draft, saved);
  const allEmailsOn = EMAIL_TYPES.every(({ type }) => types[type]);

  return (
    <>
      <CollapsibleCard
        icon={CalendarClock}
        iconClass="bg-amber-50 text-amber-600"
        title="Reminder Schedule"
        subtitle="When customers get due and overdue SMS/emails, and when staff take over with a call"
        badge={savedIsDefault ? undefined : 'Custom'}
        storageKey="settings-reminder-schedule-open"
        open={open}
        onOpenChange={setOpen}
        headerAction={!editing && (
          <button type="button" onClick={() => { setDraft(saved); setEditing(true); setOpen(true); }}
            className="px-4 py-1.5 rounded-full bg-gray-900 text-white text-xs font-bold hover:bg-gray-800">
            Edit
          </button>
        )}
      >
        <div className="grid gap-5">
          {editing ? (
            <div className="space-y-3 min-w-0">
              <div className="space-y-3 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-3">
              <Section icon={Bell} iconClass="bg-amber-50 text-amber-600" title="Due reminder"
                hint="One SMS + email before the rental is due.">
                <Field label="Send" def="0 (on the due date itself)">
                  {num('leadDays', 'days before the due date', 'Days before the due date')}
                </Field>
              </Section>

              <Section icon={MessageSquare} iconClass="bg-red-50 text-[#bf4a53]" title="Overdue SMS"
                hint="The first text goes out the day after the due date.">
                <Field label="Repeat every" def={plural(SCHEDULE_FIELDS.smsInterval.def, 'day')}>{num('smsInterval', 'days', 'Overdue SMS: repeat every N days')}</Field>
                <Field label="Up to" def={`${SCHEDULE_FIELDS.smsMax.def} texts`}>{num('smsMax', 'texts per rental', 'Overdue SMS: maximum per rental')}</Field>
              </Section>

              <Section icon={Mail} iconClass="bg-blue-50 text-blue-600" title="Overdue email"
                hint="The first email goes out the day after the due date.">
                <Field label="Repeat every" def={plural(SCHEDULE_FIELDS.emailInterval.def, 'day')}>{num('emailInterval', 'days', 'Overdue email: repeat every N days')}</Field>
                <Field label="Up to" def={`${SCHEDULE_FIELDS.emailMax.def} emails`}>{num('emailMax', 'emails per rental', 'Overdue email: maximum per rental')}</Field>
              </Section>

              <Section icon={PhoneCall} iconClass="bg-gray-100 text-gray-700" title="Hand off to staff"
                hint="Automatic SMS and email stop, and staff get a “Needs a call” task.">
                <Field label="From" def={`day ${SCHEDULE_FIELDS.manualCallDays.def}`}>{num('manualCallDays', 'days overdue', 'Days overdue before staff call')}</Field>
              </Section>
              </div>

            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 content-start min-w-0">
              <SummaryTile icon={Bell} label="Due reminder" value={shown.leadDays === 0 ? 'On the due date' : `${plural(shown.leadDays, 'day')} before`} />
              <SummaryTile icon={PhoneCall} label="Staff call" value={`From day ${shown.manualCallDays}`} />
              <SummaryTile icon={MessageSquare} label="Overdue SMS" value={`${every(shown.smsInterval)}, up to ${shown.smsMax}`} />
              <SummaryTile icon={Mail} label="Overdue email" value={`${every(shown.emailInterval)}, up to ${shown.emailMax}`} />
            </div>
          )}

          <div className="rounded-2xl bg-gray-50/80 border border-gray-100 p-4 min-w-0">
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3">{editing ? 'Preview' : 'What customers get'}</p>
            <Timeline schedule={shown} />
            <p className="text-[11px] text-gray-400 mt-4 lg:mt-5 leading-snug">Sent only during reminder hours (General → Automation &amp; Data). Customers who opted out of reminders aren&rsquo;t messaged.</p>
          </div>
          {editing && (
            <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 pt-1">
                <button type="button" onClick={save} disabled={saving || !dirty}
                  className="px-5 py-2 bg-[#bf4a53] text-white rounded-full text-sm font-bold hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" onClick={() => { setEditing(false); setDraft(saved); }} disabled={saving}
                  className="px-5 py-2 border border-gray-200 rounded-full text-sm font-bold hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
                <button type="button" onClick={() => setDraft(DEFAULTS)} disabled={draftIsDefault || saving}
                  className="sm:ml-auto inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  <RotateCcw size={14} /> Reset to defaults
                </button>
              </div>
              {draftIsDefault && dirty && (
                <p className="text-[11px] text-gray-500">Defaults filled in — press Save to apply them.</p>
              )}
            </div>
          )}
        </div>
        {msg && <p role="status" className={`text-xs font-bold mt-3 ${msg.error ? 'text-red-600' : 'text-emerald-600'}`}>{msg.text}</p>}
      </CollapsibleCard>

      <CollapsibleCard
        icon={Mail}
        iconClass="bg-blue-50 text-blue-600"
        title="Customer Emails"
        subtitle="Turn individual automatic emails on or off. Verification and password-reset emails always send."
        storageKey="settings-email-types-open"
        defaultOpen={false}
        headerAction={!allEmailsOn && (
          <button type="button" onClick={resetEmailTypes}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 text-xs font-bold text-gray-700 hover:bg-gray-50">
            <RotateCcw size={12} /> Turn all on
          </button>
        )}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {EMAIL_TYPES.map(({ type, label }) => (
            <div key={type} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-gray-100">
              <span className={`text-sm font-semibold ${types[type] ? 'text-gray-900' : 'text-gray-400'}`}>{label}</span>
              <Toggle on={types[type]} label={`${label} emails`} onClick={() => savingType !== type && toggleType(type)} />
            </div>
          ))}
        </div>
      </CollapsibleCard>
    </>
  );
}

function SummaryTile({ icon: Icon, label, value }) {
  return (
    <div className="rounded-xl border border-gray-100 p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-bold text-gray-400 uppercase tracking-wide"><Icon size={12} /> {label}</p>
      <p className="text-sm font-semibold text-gray-900 mt-1">{value}</p>
    </div>
  );
}
