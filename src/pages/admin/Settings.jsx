import React from 'react';
import { Link } from 'react-router-dom';
import {
  SlidersHorizontal, Clock, Wallet, Map, Gauge, Users, KeyRound, Activity,
  History, MessageSquare, ChevronRight, Settings as SettingsIcon,
} from 'lucide-react';
import AdminPage from '@/components/admin/ui/AdminPage';

const SECTIONS = [
  {
    title: 'Booking & Availability',
    description: 'How clients book, and when you are available.',
    cards: [
      { title: 'Booking Rules', to: '/admin/booking-rules', icon: SlidersHorizontal, desc: 'Booking window, notice required and same-day limits.' },
      { title: 'Bookable Hours', to: '/admin/booking-availability', icon: Clock, desc: 'The days, hours and slots a client can choose.' },
      { title: 'Deposit Rules', to: '/admin/deposit-rules', icon: Wallet, desc: 'When a deposit is asked for, and how much.' },
    ],
  },
  {
    title: 'Business Configuration',
    description: 'Where you work, and how demand looks.',
    cards: [
      { title: 'Service Coverage', to: '/admin/service-coverage', icon: Map, desc: 'Service zones, travel radius and priority days.' },
      { title: 'General Settings', to: '/admin/settings/general', icon: Gauge, desc: 'Live booking demand for each day and time block.' },
    ],
  },
  {
    title: 'Team & Access',
    description: 'Who works, where they start, and what they can open.',
    cards: [
      { title: 'Team Members', to: '/admin/team-members', icon: Users, desc: 'Barbers, working hours, start locations and calendars.' },
      { title: 'Staff Permissions', to: '/admin/staff-permissions', icon: KeyRound, desc: 'What each staff login is allowed to do.' },
    ],
  },
  {
    title: 'Messaging & Automation',
    description: 'Sending modes, the AI assistant and automation health.',
    cards: [
      { title: 'Messaging & Automation', to: '/admin/settings/messaging', icon: MessageSquare, desc: 'Messaging controls, the AI assistant, and whether the automation is healthy.' },
    ],
  },
  {
    title: 'System',
    description: 'The record of what changed, and the technical detail.',
    cards: [
      { title: 'Audit Log', to: '/admin/audit', icon: History, desc: 'Every scheduling and client decision, with who made it.' },
      { title: 'Advanced Diagnostics', to: '/admin/settings/messaging#diagnostics', icon: Activity, desc: 'Scheduled jobs, the message queue and failed items.' },
    ],
  },
];

const Card = ({ card }) => (
  <Link
    to={card.to}
    className="group flex items-start gap-3 rounded-xl border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
  >
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 group-hover:bg-white">
      <card.icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
    </span>
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-1">
        <span className="text-sm font-bold text-zinc-900">{card.title}</span>
        <ChevronRight className="h-3.5 w-3.5 text-zinc-300 transition-transform group-hover:translate-x-0.5 group-hover:text-zinc-500" />
      </span>
      <span className="mt-0.5 block text-xs leading-snug text-zinc-500">{card.desc}</span>
    </span>
  </Link>
);

/** The one place business configuration lives. Daily work stays in the sidebar; everything else is here. */
export default function Settings() {
  return (
    <AdminPage
      title="Settings"
      subtitle="Everything that configures CUT DELUXE, grouped so it is easy to find. Daily work stays in Calendar, Route Flow and Route."
    >
      {SECTIONS.map(section => (
        <section key={section.title} className="space-y-2">
          <div>
            <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-500">
              <SettingsIcon className="h-3.5 w-3.5" /> {section.title}
            </h2>
            <p className="text-xs text-zinc-400">{section.description}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {section.cards.map(card => <Card key={card.to} card={card} />)}
          </div>
        </section>
      ))}
    </AdminPage>
  );
}