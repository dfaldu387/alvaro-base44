import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

// The records behind a figure. `drill` is { title, note, rows, empty }.
export default function DrillDialog({ drill, onClose }) {
  const rows = drill?.rows || [];
  return (
    <Dialog open={!!drill} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{drill?.title}</DialogTitle>
          {drill?.note && <DialogDescription>{drill.note}</DialogDescription>}
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto divide-y divide-zinc-100 -mx-1 px-1">
          {rows.length === 0 && <p className="text-sm text-zinc-500 py-6 text-center">{drill?.empty || 'No records behind this figure.'}</p>}
          {rows.map((r) => (
            <div key={r.key} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-900 truncate">{r.title}</p>
                <p className="text-xs text-zinc-500">{r.subtitle}</p>
              </div>
              <span className="text-sm font-semibold text-zinc-900 shrink-0">{r.value}</span>
            </div>
          ))}
        </div>
        {rows.length > 0 && <p className="text-xs text-zinc-400">{rows.length} record{rows.length === 1 ? '' : 's'}</p>}
      </DialogContent>
    </Dialog>
  );
}