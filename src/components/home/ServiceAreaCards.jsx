import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

function daysLabel(area) {
  const days = area.service_days || [];
  if (!days.length) return 'By appointment';
  return days.join(' & ');
}

export default function ServiceAreaCards({ areas }) {
  return (
    <div className="grid gap-px overflow-hidden rounded-2xl bg-white/[0.07] sm:grid-cols-2 lg:grid-cols-3">
      {areas.map(a => (
        <Link
          key={a.id}
          to={`/book?area=${a.id}`}
          className="group flex flex-col bg-background p-6 transition-colors duration-500 hover:bg-white/[0.02]"
        >
          <span className="flex items-center gap-2.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: a.colour || 'hsl(var(--primary))' }} />
            <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{daysLabel(a)}</span>
          </span>

          <p className="mt-4 font-heading text-xl font-bold tracking-tight text-foreground">{a.name}</p>
          {a.centre_suburb && <p className="mt-1 text-sm text-muted-foreground">{a.centre_suburb}</p>}

          {(a.suburbs || []).length > 0 && (
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground/80">
              {a.suburbs.slice(0, 5).join(' · ')}
            </p>
          )}

          <span className="mt-auto flex items-center gap-1.5 pt-6 text-sm font-medium text-foreground">
            View availability
            <ArrowRight
              className="h-3.5 w-3.5 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5"
              strokeWidth={1.5}
            />
          </span>
        </Link>
      ))}
    </div>
  );
}
