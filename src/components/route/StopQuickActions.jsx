import React from 'react';
import { Navigation, Phone, MessageSquare } from 'lucide-react';
import { navigateHref } from '@/lib/navLinks';

function RoundAction({ icon, label, href, onClick }) {
  const cls = 'flex flex-col items-center justify-center gap-1 bg-background border border-border rounded-2xl w-16 h-[52px] active:opacity-70';
  const body = (<>{icon}<span className="text-[9px] font-semibold text-muted-foreground">{label}</span></>);
  return href
    ? <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className={cls}>{body}</a>
    : <button type="button" onClick={onClick} className={cls}>{body}</button>;
}

/** Navigate, Call and Message for one stop, opened from its expanded card. */
export default function StopQuickActions({ stop, onMessage }) {
  return (
    <div className="flex gap-1.5">
      <RoundAction
        icon={<Navigation className="h-4 w-4 text-foreground" />}
        label="Navigate"
        href={navigateHref(stop.address) || undefined}
      />
      {stop.phone && <RoundAction icon={<Phone className="h-4 w-4 text-foreground" />} label="Call" href={`tel:${stop.phone}`} />}
      <RoundAction icon={<MessageSquare className="h-4 w-4 text-foreground" />} label="Message" onClick={onMessage} />
    </div>
  );
}