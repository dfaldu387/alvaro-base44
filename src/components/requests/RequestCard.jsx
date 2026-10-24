import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, MapPin, Clock, Calendar, User, Phone, Scissors, ChevronDown, ChevronUp, Check, AlertCircle, ShieldAlert } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { applyManualPlacement, unscheduleBooking } from '@/lib/manualPlacement';
import { placementErrorMessage } from '@/lib/placementValidation';
import { isNeedsAction, stateLabel, stateTone, stateReason, isHeld, heldReason } from '@/lib/requestStatus';
import { bookingTransition } from '@/lib/requestAdmin';
import { approveHeld } from '@/lib/reviewQueue';
import RequestActions from '@/components/requests/RequestActions';
import HeldRequestActions from '@/components/requests/HeldRequestActions';
import EditRequestModal from '@/components/requests/EditRequestModal';
import AddToCalendarModal from '@/components/requests/AddToCalendarModal';
import DeclineRequestModal from '@/components/requests/DeclineRequestModal';
import AdminCard from '@/components/admin/ui/AdminCard';
import StatusBadge from '@/components/admin/ui/StatusBadge';

const STATUS_OPTIONS = ['pending', 'confirmed', 'declined', 'waitlist'];
// Location tier is a coverage label, not a status: priority = in the zone, the rest are neutral.
const TIER_TONE = { priority: 'success', extended: 'neutral', outer: 'warning' };

export default function RequestCard({ req, onUpdate, zoneColour }) {
  const [expanded, setExpanded] = useState(false);
  const [editTime, setEditTime] = useState(req.assigned_time || '');
  const [editStatus, setEditStatus] = useState(req.status || 'pending');
  const [saving, setSaving] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  // The request the placement dialog is open for, and whether that placement is
  // provisional (it is, when it follows an approval).
  const [placeRequest, setPlaceRequest] = useState(null);
  const [placeProvisional, setPlaceProvisional] = useState(false);
  const [showDecline, setShowDecline] = useState(false);
  const { toast } = useToast();

  const isDirty = editTime !== (req.assigned_time || '') || editStatus !== req.status;
  const colour = zoneColour || req.service_zone_colour || '#6f22cf';
  const held = isHeld(req);
  const reason = stateReason(req);

  // Booking Protection holds a request off the schedule until a person says yes. Approving it is
  // the only way it ever reaches the calendar, so the action has to live where held requests are
  // listed — otherwise the customer is never answered. Approval itself never confirms a time and
  // never messages the customer; placing it is the separate step that follows.
  const handleApprove = async (alsoPlace) => {
    setSaving(true);
    try {
      const res = await approveHeld(req.id, { place: false });
      if (res?.ok !== true) throw new Error(res?.error || 'Approve failed');
      if (alsoPlace !== true) {
        toast({ title: 'Approved', description: `${req.client_name} can now be placed on the calendar.` });
        onUpdate();
        return;
      }
      // The approval rewrites the record, so the dialog opens on the approved
      // request — otherwise the placement would be refused as out of date.
      let approved = req;
      try { approved = await base44.entities.BookingRequest.get(req.id); } catch { /* keep the row we have */ }
      setPlaceProvisional(true);
      setPlaceRequest(approved);
    } catch (e) {
      toast({ title: 'Could not approve', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // A time is never written from this page. Setting or clearing it goes through
      // the shared backend placement command, which validates it first.
      const newTime = editTime.trim();
      if (newTime !== (req.assigned_time || '')) {
        const data = newTime
          ? await applyManualPlacement({
              requestId: req.id,
              startDecimal: newTime,
              date: req.requested_date || undefined,
              barberId: req.team_member_id || null,
              expectedUpdatedDate: req.updated_date || null,
              confirmRequest: editStatus === 'confirmed',
              note: 'Set from the Requests page',
            })
          : await unscheduleBooking({ requestId: req.id });
        if (!data || data.saved !== true) {
          toast({
            title: 'Time not saved',
            description: placementErrorMessage(data?.result) || data?.error || 'The schedule check refused this time.',
            variant: 'destructive',
          });
          return;
        }
      }
      if (editStatus !== req.status) {
        if (editStatus === 'declined') {
          // Declining can move money, and the server refuses until someone says what happens to a
          // deposit it holds. So this dropdown hands over to the Decline dialog, which asks, rather
          // than firing a blind request that would come back as an unexplained failure.
          setEditStatus(req.status || 'pending');
          setShowDecline(true);
          return;
        } else {
          const res = await bookingTransition('set_status', req.id, { status: editStatus });
          if (res?.saved !== true) throw new Error(res?.error || 'Status change failed');
        }
      }
      toast({ title: 'Saved', description: `${req.client_name} updated.` });
      onUpdate();
    } catch (e) {
      toast({ title: 'Couldn’t save changes', description: 'Please try again.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminCard className="p-0 overflow-hidden" style={{ borderLeftColor: colour, borderLeftWidth: '3px' }}>
      <div className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: `${colour}20` }}>
              <User className="w-4 h-4" style={{ color: colour }} />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-zinc-900 text-sm">{req.client_name}</p>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                <span className="text-xs text-zinc-500 flex items-center gap-1 min-w-0">
                  <MapPin className="w-3 h-3 shrink-0" /><span className="break-words">{req.address}</span>
                </span>
                {req.phone && (
                  <span className="text-xs text-zinc-500 flex items-center gap-1">
                    <Phone className="w-3 h-3" />{req.phone}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {req.is_test && <StatusBadge status="test" className="uppercase">Test</StatusBadge>}
            {req.priority_status && (
              <StatusBadge tone={req.priority_status === 'priority' ? 'success' : 'warning'}>
                {req.priority_status === 'priority' ? 'Priority' : 'Outside'}
              </StatusBadge>
            )}
            {req.location_tier && TIER_TONE[req.location_tier] && (
              <StatusBadge tone={TIER_TONE[req.location_tier]} className="capitalize">{req.location_tier}</StatusBadge>
            )}
            <StatusBadge tone={stateTone(req)}>{stateLabel(req)}</StatusBadge>
            <button
              onClick={() => setExpanded(!expanded)}
              aria-label={expanded ? 'Collapse request details' : 'Expand request details'}
              aria-expanded={expanded}
              className="text-zinc-500 hover:text-zinc-900 w-11 h-11 flex items-center justify-center rounded-lg hover:bg-zinc-100"
            >
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-zinc-500">
          <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{req.day}</span>
          {req.requested_date && (
            <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{req.requested_date}</span>
          )}
          <span className="text-zinc-900 font-medium flex items-center gap-1"><Clock className="w-3 h-3" />{req.availability_window}</span>
          {req.services?.length > 0 && (
            <span className="flex items-center gap-1"><Scissors className="w-3 h-3" />{req.services.join(', ')}</span>
          )}
        </div>

        {held ? (
          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
              <ShieldAlert className="w-3 h-3 shrink-0" />Held for review
            </p>
            {heldReason(req) && (
              <p className="mt-0.5 pl-4 text-xs text-amber-700 leading-snug">{heldReason(req)}</p>
            )}
            <p className="mt-1 pl-4 text-[11px] text-amber-700/80">
              Not on the schedule until it is approved.
            </p>
          </div>
        ) : reason && (
          <p className="flex items-center gap-1.5 mt-2 text-xs font-medium text-amber-700">
            <AlertCircle className="w-3 h-3 shrink-0" />{reason}
          </p>
        )}

        {/* Every unresolved request offers all three ways forward, so none is a dead end */}
        {isNeedsAction(req) && (
          <div className="mt-3 pt-3 border-t border-zinc-100">
            {held ? (
              <HeldRequestActions
                onApprovePlace={() => handleApprove(true)}
                onApproveOnly={() => handleApprove(false)}
                onReject={() => setShowDecline(true)}
                disabled={saving}
              />
            ) : (
              <RequestActions
                onEdit={() => setShowEdit(true)}
                onAddToCalendar={() => { setPlaceProvisional(false); setPlaceRequest(req); }}
                onDecline={() => setShowDecline(true)}
                disabled={saving}
              />
            )}
          </div>
        )}

        {req.assigned_time && !expanded && (
          <div className="mt-2 pt-2 border-t border-zinc-100 flex items-center justify-between text-sm">
            <span className="text-zinc-500 text-xs">Appointment</span>
            <span className="font-semibold text-indigo-600">{req.assigned_time}</span>
          </div>
        )}
      </div>

      {expanded && (
        <div className="border-t border-zinc-200 px-4 py-3 space-y-3 bg-zinc-50">
          {/* Location snapshot — permanent record of the address at submission time */}
          <div className="space-y-1.5">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Service Address</p>
            <p className="text-xs text-zinc-900 leading-relaxed">{req.address || '—'}</p>
            {(req.address_suburb || req.address_postcode) && (
              <p className="text-xs text-zinc-500">{[req.address_suburb, req.address_postcode].filter(Boolean).join(', ')}</p>
            )}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              {(req.matched_service_zone_name || req.service_area_name) && (
                <span className="text-xs">
                  <span className="text-zinc-900 font-medium">{req.matched_service_zone_name || req.service_area_name}</span>
                  {req.location_tier && <span className="text-zinc-500"> · {req.location_tier}</span>}
                </span>
              )}
              {req.distance_from_zone_km != null && (
                <span className="text-xs text-zinc-500">{req.distance_from_zone_km} km</span>
              )}
            </div>
            {(req.address_lat != null || req.address_lng != null) && (
              <p className="text-[10px] text-zinc-400 font-mono pt-0.5">
                {req.address_lat?.toFixed(4)}, {req.address_lng?.toFixed(4)}
              </p>
            )}
          </div>
          {req.notes && (
            <p className="text-xs text-zinc-500 italic">"{req.notes}"</p>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1">
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 block">Assign Time</label>
              <Input
                value={editTime}
                onChange={e => setEditTime(e.target.value)}
                placeholder="e.g. 5:15pm"
                className="bg-white h-10 text-sm"
              />
            </div>
            <div className="sm:w-36">
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 block">Status</label>
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger className="bg-white h-10 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(s => (
                    <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {isDirty && (
            <Button size="sm" className="w-full h-10 text-xs" onClick={handleSave} disabled={saving} aria-busy={saving}>
              {saving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Check className="w-3 h-3 mr-1" />}
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
          )}
        </div>
      )}

      {showEdit && (
        <EditRequestModal request={req} onClose={() => setShowEdit(false)} onDone={() => onUpdate()} />
      )}
      {placeRequest && (
        <AddToCalendarModal
          request={placeRequest}
          provisional={placeProvisional}
          onClose={() => { setPlaceRequest(null); setPlaceProvisional(false); }}
          onDone={() => {
            setPlaceProvisional(false);
            onUpdate();
          }}
        />
      )}
      {showDecline && (
        <DeclineRequestModal request={req} onClose={() => setShowDecline(false)} onDone={() => onUpdate()} />
      )}
    </AdminCard>
  );
}