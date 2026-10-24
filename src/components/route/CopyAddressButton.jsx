import React from 'react';
import { Copy, Check } from 'lucide-react';
import useCopyAddress from '@/components/route/execution/useCopyAddress';

/**
 * A small copy control that sits beside an address — never a full action button.
 * It copies the appointment's saved address and confirms with a short "Address copied"
 * label; a clipboard the browser refuses leaves the address untouched and says nothing.
 */
export default function CopyAddressButton({ address, className = '' }) {
  const { copied, copy } = useCopyAddress();
  if (!String(address || '').trim()) return null;

  return (
    <button
      type="button"
      // Inside a card that opens on click: copying must not also open or close it.
      onClick={(e) => { e.stopPropagation(); copy(address); }}
      onKeyDown={(e) => e.stopPropagation()}
      aria-label="Copy address"
      title="Copy address"
      className={`inline-flex shrink-0 items-center gap-1 rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground active:opacity-60 ${className}`}
    >
      {copied
        ? <Check className="h-3 w-3 text-green-500" />
        : <Copy className="h-3 w-3" />}
      {copied && (
        <span className="whitespace-nowrap text-[10px] font-semibold text-green-500">Address copied</span>
      )}
    </button>
  );
}