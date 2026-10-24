import React from 'react';
import { Button } from '@/components/ui/button';
import StagePreview from '@/components/reminders/StagePreview';

/** The review screen for the dry run. Records here are previews only: no Message or outbox rows exist for them. */
export default function DryRunPreview({ preview, running, onRun }) {
  const sc = preview.schedule;
  return (
    <section className="space-y-3 rounded-xl border-2 border-amber-300 bg-amber-50/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-zinc-900">Dry-run preview · Dry run — nothing sent</h2>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="bg-white text-zinc-800 hover:bg-zinc-100" disabled={!!running} onClick={() => onRun('outreach')}>{running === 'outreach' ? 'Running…' : 'Run reminder preview'}</Button>
          <Button size="sm" variant="outline" className="bg-white text-zinc-800 hover:bg-zinc-100" disabled={!!running} onClick={() => onRun('followup')}>{running === 'followup' ? 'Running…' : 'Run follow-up preview'}</Button>
        </div>
      </div>
      <p className="text-xs text-zinc-600">Reminders go out on {sc.outreach_day}, follow-ups on {sc.followup_day}, from {sc.run_hour}:00 ({sc.timezone}). Week {preview.week}. Dry-run mode is {preview.dry_run ? 'ON' : 'OFF'}. Booking link in messages: {sc.booking_link}</p>
      <StagePreview title="Reminders" s={preview.stages.outreach} />
      <StagePreview title="Follow-ups" s={preview.stages.followup} />
      <p className="text-[11px] text-zinc-500">{preview.cap_rule}</p>
    </section>
  );
}