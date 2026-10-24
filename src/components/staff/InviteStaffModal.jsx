/**
 * InviteStaffModal — form for inviting a new staff member.
 * Collects: name, email, phone, job title, role, bookable.
 * Calls the inviteStaffMember backend function which creates the
 * TeamMember + User account and sends the invitation email.
 */
import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { DEFAULT_WORKING_HOURS } from '@/lib/businessHoursUtils';
import { X, Loader2, Mail, Phone, User, Briefcase, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function InviteStaffModal({ onClose, onInvited }) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    job_title: 'Barber',
    role: 'barber',
    is_bookable: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.name.trim()) { setError('Full name is required.'); return; }
    if (!form.email.trim()) { setError('Email address is required.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) { setError('Valid email address is required.'); return; }

    setSaving(true);
    try {
      const res = await base44.functions.invoke('inviteStaffMember', {
        name: form.name,
        email: form.email,
        phone: form.phone,
        job_title: form.job_title,
        role: form.role,
        is_bookable: form.is_bookable,
        working_hours: DEFAULT_WORKING_HOURS,
      });
      onInvited(res.data.member);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to invite team member.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200">
          <h2 className="text-base font-bold text-zinc-900">Invite Team Member</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {/* Name */}
          <div>
            <label className="text-xs font-semibold text-zinc-700 mb-1 block">Full name *</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <input
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="e.g. John Smith"
                className="w-full bg-white border border-zinc-200 rounded-lg pl-9 pr-3 py-2 text-sm text-zinc-900 outline-none focus:border-[#5E42F3] placeholder:text-zinc-400"
                autoFocus
              />
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="text-xs font-semibold text-zinc-700 mb-1 block">Email address *</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <input
                type="email"
                value={form.email}
                onChange={e => set('email', e.target.value)}
                placeholder="john@example.com"
                className="w-full bg-white border border-zinc-200 rounded-lg pl-9 pr-3 py-2 text-sm text-zinc-900 outline-none focus:border-[#5E42F3] placeholder:text-zinc-400"
              />
            </div>
            <p className="text-[11px] text-zinc-400 mt-1">They'll receive an invitation to set their password.</p>
          </div>

          {/* Phone */}
          <div>
            <label className="text-xs font-semibold text-zinc-700 mb-1 block">Phone number</label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <input
                value={form.phone}
                onChange={e => set('phone', e.target.value)}
                placeholder="04xx xxx xxx"
                className="w-full bg-white border border-zinc-200 rounded-lg pl-9 pr-3 py-2 text-sm text-zinc-900 outline-none focus:border-[#5E42F3] placeholder:text-zinc-400"
              />
            </div>
          </div>

          {/* Job title */}
          <div>
            <label className="text-xs font-semibold text-zinc-700 mb-1 block">Job title</label>
            <div className="relative">
              <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <input
                value={form.job_title}
                onChange={e => set('job_title', e.target.value)}
                placeholder="e.g. Barber, Senior Barber"
                className="w-full bg-white border border-zinc-200 rounded-lg pl-9 pr-3 py-2 text-sm text-zinc-900 outline-none focus:border-[#5E42F3] placeholder:text-zinc-400"
              />
            </div>
          </div>

          {/* Role */}
          <div>
            <label className="text-xs font-semibold text-zinc-700 mb-1.5 block">Role</label>
            <div className="relative">
              <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <select
                value={form.role}
                onChange={e => set('role', e.target.value)}
                className="w-full bg-white border border-zinc-200 rounded-lg pl-9 pr-3 py-2 text-sm text-zinc-900 outline-none focus:border-[#5E42F3] cursor-pointer appearance-none"
              >
                <option value="barber">Barber — limited admin access</option>
                <option value="admin">Admin — full admin access</option>
              </select>
            </div>
          </div>

          {/* Bookable toggle */}
          <div className="flex items-center justify-between bg-zinc-50 border border-zinc-200 rounded-lg px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-zinc-900">Bookable</p>
              <p className="text-xs text-zinc-500">Available for online booking</p>
            </div>
            <button
              type="button"
              onClick={() => set('is_bookable', !form.is_bookable)}
              className={cn('w-9 h-5 rounded-full transition-colors relative shrink-0', form.is_bookable ? 'bg-[#5E42F3]' : 'bg-zinc-300')}
            >
              <span className={cn('absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform', form.is_bookable && 'translate-x-4')} />
            </button>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-10 border border-zinc-200 text-zinc-700 text-sm font-semibold rounded-lg hover:bg-zinc-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 h-10 bg-[#5E42F3] hover:bg-[#4F35E0] text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : 'Save & Send Invite'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}