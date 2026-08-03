import { CheckCircle2, CalendarCheck, Calendar, Droplets, AlertTriangle, Trash2 } from 'lucide-react';

// Single source of truth for status pill colors. One color = one meaning:
//   green  = good / ready       (Available, Returned)
//   blue   = out with customer  (Rented, Active)
//   indigo = booked ahead       (Reserved)
//   orange = in process         (Cleaning)
//   red    = problem / urgent   (OutOfService, Overdue)
//   gray   = neutral / archived (Deleted, Cancelled)
// Uniform shade depth everywhere: -50 bg / -700 text / -200 border / -500 dot.

export const ITEM_STATUS_PILLS = {
  Available: { label: 'Available', icon: CheckCircle2, bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500', border: 'border-emerald-200' },
  Rented: { label: 'Rented', icon: CalendarCheck, bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500', border: 'border-blue-200' },
  Reserved: { label: 'Reserved', icon: Calendar, bg: 'bg-indigo-50', text: 'text-indigo-700', dot: 'bg-indigo-400', border: 'border-indigo-200' },
  Cleaning: { label: 'Cleaning', icon: Droplets, bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-400', border: 'border-orange-200' },
  OutOfService: { label: 'Out of Service', icon: AlertTriangle, bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500', border: 'border-red-200' },
  Deleted: { label: 'Archived', icon: Trash2, bg: 'bg-gray-100', text: 'text-gray-500', dot: 'bg-gray-400', border: 'border-gray-200' },
};

export const TX_STATUS_PILLS = {
  Reserved: { bg: 'bg-indigo-50', text: 'text-indigo-700', dot: 'bg-indigo-400', border: 'border-indigo-200', ring: 'ring-indigo-200' },
  Active: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500', border: 'border-blue-200', ring: 'ring-blue-200' },
  Overdue: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500', border: 'border-red-200', ring: 'ring-red-200' },
  Returned: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500', border: 'border-emerald-200', ring: 'ring-emerald-200' },
  Cancelled: { bg: 'bg-gray-100', text: 'text-gray-500', dot: 'bg-gray-400', border: 'border-gray-200', ring: 'ring-gray-200' },
};

export const itemPill = (status) => ITEM_STATUS_PILLS[status] || ITEM_STATUS_PILLS.Deleted;
export const txPill = (status) => TX_STATUS_PILLS[status] || TX_STATUS_PILLS.Cancelled;
