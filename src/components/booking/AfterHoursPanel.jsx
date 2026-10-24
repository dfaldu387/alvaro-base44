import React from 'react';
import { Moon, ChevronDown, ChevronUp, MapPin, Car, Info } from 'lucide-react';

export default function AfterHoursPanel({ expanded, onToggle, mode, onMode, slot, onSlot, slots }) {
  if (!expanded) {
    return (
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between rounded-2xl border border-primary/40 bg-[#1a0f2e] px-4 py-3.5 active:opacity-70 transition-all"
      >
        <div className="flex items-start gap-2.5 text-left">
          <Moon className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <div className="leading-tight">
            <p className="text-[13px] font-bold text-foreground">After Hours</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Exact appointment times available</p>
          </div>
        </div>
        <div className="flex items-center gap-1 text-[12px] font-semibold text-primary shrink-0">
          View after-hours options
          <ChevronDown className="w-4 h-4" />
        </div>
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-primary/40 bg-[#1a0f2e] p-4 space-y-3.5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Moon className="w-4 h-4 text-primary" />
          <div className="leading-none">
            <p className="text-[13px] font-bold text-foreground tracking-wide uppercase">After Hours Options</p>
            <p className="text-[11px] text-muted-foreground mt-1">Choose how you'd like to book</p>
          </div>
        </div>
        <button onClick={onToggle} className="text-muted-foreground hover:text-foreground shrink-0">
          <ChevronUp className="w-4 h-4" />
        </button>
      </div>

      <AfterHoursOption
        selected={mode === 'come_to_me'}
        onClick={() => onMode('come_to_me')}
        icon={MapPin}
        title="Come to me"
        lines={['Meet at my location', 'Same service price']}
      />
      <AfterHoursOption
        selected={mode === 'mobile_callout'}
        onClick={() => onMode('mobile_callout')}
        icon={Car}
        title="I come to you"
        lines={['Mobile call-out', 'Service price + $50']}
        accent
      />

      {/* Slots */}
      <div>
        <p className="text-[11px] font-semibold text-muted-foreground tracking-wide uppercase mb-2">Available Time Slots</p>
        <div className="flex flex-wrap gap-2">
          {slots.length === 0 && (
            <p className="text-[12px] text-muted-foreground leading-relaxed">No after-hours slots can fit your selected services before 9:00pm.</p>
          )}
          {slots.map(s => (
            <button
              key={s}
              onClick={() => onSlot(s)}
              className={`px-3.5 py-2 rounded-full text-[12px] font-semibold border transition-all ${
                slot === s
                  ? 'bg-primary text-white border-primary shadow-[0_0_14px_rgba(139,61,255,0.5)]'
                  : 'bg-card text-foreground border-primary/40 active:opacity-70'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Info notice */}
      <div className="flex items-start gap-2 rounded-xl bg-card border border-border px-3 py-2.5">
        <Info className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
        <p className="text-[11px] text-muted-foreground leading-relaxed">After hours bookings are subject to availability and may require manual approval.</p>
      </div>
    </div>
  );
}

function AfterHoursOption({ selected, onClick, icon: Icon, title, lines, accent }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all ${
        selected ? 'border-primary bg-primary/[0.08] shadow-[0_0_14px_rgba(139,61,255,0.25)]' : 'border-border bg-card active:opacity-70'
      }`}
    >
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${selected ? 'bg-primary/15 border border-primary/40' : 'bg-secondary border border-border'}`}>
        <Icon className={`w-4 h-4 ${selected ? 'text-primary' : 'text-muted-foreground'}`} />
      </div>
      <div className="flex-1 min-w-0 leading-tight">
        <p className="text-[13px] font-bold text-foreground">{title}</p>
        {lines.map((l, i) => (
          <p key={i} className={`text-[11px] mt-0.5 ${accent && i === 1 ? 'text-primary font-semibold' : 'text-muted-foreground'}`}>{l}</p>
        ))}
      </div>
      <div className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center ${selected ? 'border-primary' : 'border-muted-foreground/50'}`}>
        {selected && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
      </div>
    </button>
  );
}