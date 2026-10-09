import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Loader2, TriangleAlert } from 'lucide-react';
import { usePayments } from '../hooks/usePayments';
import { useToast } from '../components/Toast';

// How often we ask the server what happened, and how long we keep asking.
const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 200; // 3s * 200 = 10 minutes
const SETTLED = new Set(['succeeded', 'failed', 'expired']);

// Landing page for a customer returning from Maya (or its cancellation path).
//
// The Maya webhook is the source of truth for whether money moved, so this page
// never assumes success — it asks the server. That same request is also the
// self-heal: if the webhook was lost, the server credits the payment here.
export default function PaymentReturnView() {
  const navigate = useNavigate();
  const { getStatus, createIntent } = usePayments();
  const { error: toastError } = useToast();
  const [status, setStatus] = useState('checking');
  const [received, setReceived] = useState(null);
  const [amountDue, setAmountDue] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const txId = new URLSearchParams(window.location.search).get('tx');
  // Guards against setting state after unmount (the user navigates away mid-poll).
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (!txId) {
      setStatus('invalid');
      return undefined;
    }

    let polls = 0;
    let timer = null;

    const poll = async () => {
      polls += 1;
      try {
        const result = await getStatus(txId);
        if (!alive.current) return;
        const next = result?.status ?? 'pending';
        setStatus(next);
        if (result?.totalPaid != null) setReceived(result.totalPaid);
        if (result?.amountDue != null) setAmountDue(result.amountDue);
        // A settled outcome ends the loop; anything else keeps waiting until we
        // hit the ceiling, so a wedged payment can't poll forever. 'partial'
        // already arrived, so it stops too.
        if (SETTLED.has(next) || next === 'partial' || polls >= MAX_POLLS) return;
      } catch {
        if (!alive.current) return;
        // A transient network blip shouldn't look like a failure — keep trying.
        if (polls >= MAX_POLLS) {
          setStatus('unknown');
          return;
        }
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    poll();

    return () => {
      alive.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [txId, getStatus]);

  useEffect(() => {
    if (status === 'failed' || status === 'expired' || status === 'unknown') {
      toastError('Payment not completed.');
    }
  }, [status, toastError]);

  // A Maya QRPh is one-time use and expires after an hour. When that happens the
// customer must be able to start a fresh charge themselves — otherwise an
// expired code or a cancelled payment means an in-person visit. The new charge
// supersedes the old one; the old paymentId's late webhook is absorbed by the
// ledger's idempotency + closed-charge guards.
const handlePayAgain = async () => {
  const amount = Number(amountDue) > 0 ? Number(amountDue) : 0;
  if (!txId || amount <= 0) return;
  setRetrying(true);
  try {
    const intent = await createIntent({ transactionId: txId, amount });
    if (intent?.simulated) {
      // No gateway configured locally — nothing to redirect to.
      setStatus('pending');
      return;
    }
    if (intent?.redirectUrl) {
      window.location.assign(intent.redirectUrl);
      return;
    }
    toastError('Payment is not available right now. Please contact the boutique.');
  } catch (err) {
    toastError(err?.message || 'Could not start a new payment. Please try again.');
  } finally {
    setRetrying(false);
  }
};

if (status === 'partial') {
    // Money landed but it doesn't cover the required downpayment. Saying
    // "confirmed" here would be a lie, so say exactly what happened instead.
    return (
      <Shell>
        <TriangleAlert size={56} className="text-amber-500" />
        <h1 className="text-2xl font-bold text-gray-900">Payment received</h1>
        <p className="text-sm text-gray-500 text-center max-w-sm">
          We received {received && `₱${Number(received).toLocaleString()} `}
          but this is less than the downpayment required to secure your booking.
          Please complete the remaining amount to confirm it.
        </p>
        <button
          onClick={() => navigate(txId ? `/transactions/${txId}` : '/')}
          className="mt-2 w-full max-w-xs py-3 rounded-full font-bold text-sm bg-[#bf4a53] text-white hover:bg-red-700 shadow transition-colors"
        >
          Complete my booking
        </button>
      </Shell>
    );
  }

  if (status === 'succeeded') {
    return (
      <Shell>
        <CheckCircle2 size={64} className="text-emerald-500" />
        <h1 className="text-2xl font-bold text-gray-900">Payment confirmed</h1>
        <p className="text-sm text-gray-500 text-center max-w-sm">
          Your downpayment is received and your booking is secured.
        </p>
        <button
          onClick={() => navigate(`/transactions/${txId}`)}
          className="mt-2 w-full max-w-xs py-3 rounded-full font-bold text-sm bg-[#bf4a53] text-white hover:bg-red-700 shadow transition-colors"
        >
          View my booking
        </button>
      </Shell>
    );
  }

  if (status === 'failed' || status === 'expired' || status === 'unknown') {
    return (
      <Shell>
        <TriangleAlert size={56} className="text-amber-500" />
        <h1 className="text-2xl font-bold text-gray-900">Payment not completed</h1>
        <p className="text-sm text-gray-500 text-center max-w-sm">
          {status === 'expired'
            ? 'The payment code expired before it was scanned. Your booking is still saved.'
            : 'We could not confirm a payment. Your booking is still saved — you can pay again from it.'}
        </p>
        <div className="flex flex-col gap-2 w-full max-w-xs">
          {Number(amountDue) > 0 && (
            <button
              onClick={handlePayAgain}
              disabled={retrying}
              className="py-3 rounded-full font-bold text-sm bg-[#bf4a53] text-white hover:bg-red-700 shadow transition-colors disabled:opacity-50"
            >
              {retrying ? 'Starting…' : `Pay the remaining ₱${Number(amountDue).toLocaleString()}`}
            </button>
          )}
          <button
            onClick={() => navigate(txId ? `/transactions/${txId}` : '/')}
            className="py-3 rounded-full font-bold text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
          >
            View my booking
          </button>
          <button
            onClick={() => navigate('/collection')}
            className="py-3 rounded-full font-bold text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
          >
            Back to the collection
          </button>
        </div>
      </Shell>
    );
  }

  if (status === 'invalid') {
    return (
      <Shell>
        <TriangleAlert size={56} className="text-amber-500" />
        <h1 className="text-2xl font-bold text-gray-900">Nothing to confirm</h1>
        <p className="text-sm text-gray-500 text-center max-w-sm">
          This link is missing its booking reference.
        </p>
        <button
          onClick={() => navigate('/')}
          className="mt-2 w-full max-w-xs py-3 rounded-full font-bold text-sm bg-[#bf4a53] text-white hover:bg-red-700 shadow transition-colors"
        >
          Go home
        </button>
      </Shell>
    );
  }

  return (
    <Shell>
      <Loader2 size={48} className="text-[#bf4a53] animate-spin" />
      <h1 className="text-2xl font-bold text-gray-900">Confirming your payment…</h1>
      <p className="text-sm text-gray-500 text-center max-w-sm">
        This usually takes a few seconds. Please keep this page open.
      </p>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-[#fcfcfd] flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl p-8 flex flex-col items-center gap-4">
        {children}
      </div>
    </div>
  );
}
