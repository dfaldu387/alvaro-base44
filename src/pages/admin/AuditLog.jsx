import React, { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import AdminPage from '@/components/admin/ui/AdminPage';
import ErrorState from '@/components/states/ErrorState';
import EmptyState from '@/components/states/EmptyState';
import { Button } from '@/components/ui/button';
import AuditRow from '@/components/audit/AuditRow';
import { AUDIT_CATEGORIES, loadAudit } from '@/lib/auditTrail';
import { cn } from '@/lib/utils';

export default function AuditLog() {
  const [category, setCategory] = useState('all');
  const [items, setItems] = useState(null);
  const [next, setNext] = useState(null);
  const [failed, setFailed] = useState(false);
  const [more, setMore] = useState(false);

  const load = useCallback(() => {
    setItems(null); setFailed(false);
    loadAudit(base44, { category }).then((p) => { setItems(p.items); setNext(p.next); }).catch(() => setFailed(true));
  }, [category]);
  useEffect(() => { load(); }, [load]);

  const loadMore = () => {
    setMore(true);
    loadAudit(base44, { category, cursor: next })
      .then((p) => { setItems((prev) => [...prev, ...p.items]); setNext(p.next); })
      .catch(() => setFailed(true))
      .finally(() => setMore(false));
  };

  return (
    <AdminPage title="Audit Log" subtitle="Who changed payments, people, messages and data, and when. Phone numbers and emails are never kept here.">
      <div className="flex flex-wrap gap-2">
        {AUDIT_CATEGORIES.map((c) => (
          <button key={c.value} type="button" onClick={() => setCategory(c.value)}
            className={cn('min-h-[44px] px-3 rounded-full border text-xs font-semibold', category === c.value ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-700 border-zinc-200')}>
            {c.label}
          </button>
        ))}
      </div>
      {failed && <ErrorState title="Couldn't load the audit log" description="Please try again." onRetry={load} />}
      {!failed && items === null && <p className="text-sm text-zinc-500">Loading…</p>}
      {!failed && items && items.length === 0 && <EmptyState title="Nothing recorded yet" description="Entries appear here as soon as someone makes one of these changes." />}
      {items && items.length > 0 && (
        <div className="space-y-2">
          {items.map((it) => <AuditRow key={it.id} item={it} />)}
          {next && <Button variant="outline" className="w-full min-h-[44px]" disabled={more} onClick={loadMore}>{more ? 'Loading…' : 'Show older'}</Button>}
        </div>
      )}
    </AdminPage>
  );
}