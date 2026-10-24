import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert, ArrowRight } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { HELD_QUERY } from '@/lib/reviewQueue';

// Shown on the dashboard whenever the Needs Review queue is not empty. It points at the Requests
// page, which lists held requests and carries the Approve action; /admin/review-queue is now only
// a redirect into the Calendar drawer, which cannot approve.
export default function HeldBanner() {
  const [n, setN] = useState(0);
  useEffect(() => { base44.entities.BookingRequest.count(HELD_QUERY).then(setN).catch(() => {}); }, []);
  if (!n) return null;
  return (
    <Link to="/admin/requests" className="mb-6 flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 hover:bg-amber-100">
      <ShieldAlert className="w-5 h-5 text-amber-700 shrink-0" />
      <span className="flex-1 text-sm font-semibold text-amber-900">{n} booking request{n === 1 ? ' is' : 's are'} held for review and not on the schedule yet.</span>
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800">Review <ArrowRight className="w-3 h-3" /></span>
    </Link>
  );
}