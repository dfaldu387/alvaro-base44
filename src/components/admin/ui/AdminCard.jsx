import React from 'react';
import { cn } from '@/lib/utils';

// Standard admin card: white surface, zinc border, rounded-xl.
export default function AdminCard({ className, children, ...rest }) {
  return (
    <div className={cn('bg-white border border-zinc-200 rounded-xl p-4', className)} {...rest}>
      {children}
    </div>
  );
}