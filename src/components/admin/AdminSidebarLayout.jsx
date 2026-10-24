import React, { useEffect, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import {
  Crown, LayoutDashboard, Users, CalendarDays, MapPin,
  Scissors, MessageSquare, BarChart2, Settings, Menu as MenuIcon, X, LogOut,
  Bot, CreditCard, BellRing,
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import useOpenAssistantCount from '@/hooks/useOpenAssistantCount';
import useOverdueJobs from '@/hooks/useOverdueJobs';
import OverdueJobsBanner from '@/components/automation/OverdueJobsBanner';
import { cn } from '@/lib/utils';

// Settings is one destination, so every configuration page it leads to keeps the
// Settings row lit rather than looking like a page with no home.
const SETTINGS_PATHS = [
  '/admin/booking-rules', '/admin/booking-availability', '/admin/deposit-rules',
  '/admin/service-coverage', '/admin/team-members', '/admin/staff-permissions',
  '/admin/audit',
];

const NAV_SECTIONS = [
  {
    label: null,
    items: [{ label: 'Dashboard', to: '/admin/dashboard', icon: LayoutDashboard, exact: true }],
  },
  {
    // Route Flow decides, the Calendar controls, the Route executes. Booking requests
    // and their states (Needs Review included) live in the Calendar's requests drawer,
    // so they are never a second destination in here.
    label: 'Operations',
    items: [
      { label: 'Calendar', to: '/admin/schedule', icon: CalendarDays },
      { label: 'Route Flow', to: '/admin/scheduling-bot', icon: Bot },
      { label: 'Route', to: '/admin/route', icon: MapPin },
    ],
  },
  {
    // One reminder destination: the weekly pipeline, the campaigns and their history
    // are tabs there, and VIP clients are a filter on Clients.
    label: 'Clients',
    items: [
      { label: 'Clients', to: '/admin/clients', icon: Users },
      { label: 'Messages', to: '/admin/messages', icon: MessageSquare },
      { label: 'Reminders', to: '/admin/reminders', icon: BellRing },
    ],
  },
  {
    label: 'Business',
    items: [
      { label: 'Services', to: '/admin/services', icon: Scissors },
      { label: 'Payments', to: '/admin/payments', icon: CreditCard },
      { label: 'Reports', to: '/admin/reports', icon: BarChart2 },
    ],
  },
  {
    label: 'System',
    items: [
      { label: 'Settings', to: '/admin/settings', icon: Settings, match: SETTINGS_PATHS },
    ],
  },
];

function SidebarContent({ onNavigate, overdueCount }) {
  const location = useLocation();
  const assistantCount = useOpenAssistantCount();
  const isActive = (item) => {
    if (item.exact) return location.pathname === item.to;
    if (location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)) return true;
    return (item.match || []).some((p) => location.pathname.startsWith(p));
  };
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <Crown className="h-5 w-5 shrink-0 text-[#a78bfa]" />
        <div className="min-w-0 leading-none">
          <p className="truncate text-[13px] font-bold tracking-tight text-white">CUT DELUXE</p>
          <p className="mt-1 text-[9px] tracking-[0.18em] text-zinc-500">MOBILE BARBERING</p>
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {NAV_SECTIONS.map((section, si) => (
          <div key={si} className={si > 0 ? 'pt-5' : ''}>
            {section.label && (
              <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                {section.label}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map(item => {
                const active = isActive(item);
                return (
                  <Link key={item.to} to={item.to} onClick={onNavigate}
                    className={cn('group flex items-center gap-2.5 rounded-md px-3 py-[7px] text-[13px] transition-colors',
                      active
                        ? 'bg-[#7c3aed]/15 font-semibold text-white'
                        : 'font-medium text-zinc-400 hover:bg-white/5 hover:text-white')}>
                    <item.icon
                      className={cn('h-[18px] w-[18px] shrink-0 transition-colors',
                        active ? 'text-[#a78bfa]' : 'text-zinc-500 group-hover:text-zinc-300')}
                      strokeWidth={1.75}
                    />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.to === '/admin/messages' && assistantCount > 0 && (
                      <span className="ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">{assistantCount}</span>
                    )}
                    {item.to === '/admin/settings' && overdueCount > 0 && (
                      <span className="ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">{overdueCount}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* One row instead of three: the account, with sign-out as its action.
          The old block spent about 200px of height on a summary that repeated
          the dashboard, a full-width Log Out button and two rules — height the
          navigation needed, which is why the list was scrolling at all. */}
      <div className="mx-3 border-t border-white/10" />
      <div className="flex items-center gap-2.5 px-4 py-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-bold text-white">CD</div>
        <div className="min-w-0 flex-1 leading-none">
          <p className="truncate text-[13px] font-semibold text-white">Cut Deluxe</p>
          <p className="mt-0.5 text-[11px] text-zinc-500">Admin</p>
        </div>
        <button
          onClick={() => base44.auth.logout('/')}
          aria-label="Log out"
          title="Log out"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default function AdminSidebarLayout() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const overdue = useOverdueJobs();
  // Every admin page is light, the in-van Route screen included. Set on <body> so portals match.
  // Route was deliberately dark for use in the van; made light on request.
  useEffect(() => {
    document.body.classList.add('admin-light');
    return () => document.body.classList.remove('admin-light');
  }, [pathname]);
  return (
    <div className="min-h-screen flex bg-white">
      <div className="lg:hidden fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-4 h-14 bg-white border-b border-zinc-200">
        <button onClick={() => setOpen(true)} className="w-11 h-11 flex items-center justify-center text-zinc-700"><MenuIcon className="w-5 h-5" /></button>
        <div className="flex items-center gap-2"><Crown className="w-5 h-5 text-indigo-600" /><span className="font-bold text-sm text-zinc-900">CUT DELUXE</span></div>
        <div className="w-9" />
      </div>

      <aside className="hidden lg:flex w-64 shrink-0 bg-[#0F1117] border-r border-black/40 sticky top-0 h-screen">
        <SidebarContent onNavigate={() => {}} overdueCount={overdue.length} />
      </aside>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />
          <aside className="fixed top-0 left-0 bottom-0 z-50 w-64 bg-[#0F1117] border-r border-black/40 lg:hidden">
            <button onClick={() => setOpen(false)} className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center text-zinc-500"><X className="w-5 h-5" /></button>
            <SidebarContent onNavigate={() => setOpen(false)} overdueCount={overdue.length} />
          </aside>
        </>
      )}

      <main className="flex-1 min-w-0 pt-14 lg:pt-0">
        <OverdueJobsBanner jobs={overdue} />
        <Outlet />
      </main>
    </div>
  );
}