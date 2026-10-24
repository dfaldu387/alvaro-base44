import React from 'react';
import { AlertCircle } from 'lucide-react';
import PlacementGhost from '@/components/schedule/PlacementGhost';
import TravelWarningDialog from '@/components/schedule/TravelWarningDialog';
import CreateMenu from '@/components/schedule/CreateMenu';
import CreateBookingModal from '@/components/schedule/CreateBookingModal';
import BlockTimeModal from '@/components/schedule/BlockTimeModal';
import BlockTimeEditDialog from '@/components/schedule/BlockTimeEditDialog';
import BlockTimeDeleteDialog from '@/components/schedule/BlockTimeDeleteDialog';

/**
 * Everything the Calendar lays over itself: the drag in flight, the two decisions a
 * placement may still need (outside the Booking Window, and travel that cannot be
 * achieved), and the create modals.
 *
 * Extracted from the page so the Calendar itself reads as the workspace — the
 * week, the requests column and the toolbar — rather than as a wall of overlays.
 * Nothing here decides anything: each piece reports back through a callback the
 * Calendar owns.
 */
export default function CalendarOverlays({
  // Booking Window override — an administrator scheduling outside the window
  windowPrompt, onCancelWindowOverride, onConfirmWindowOverride,
  // Travel that cannot be achieved — an explicit, audited admin decision
  travelPrompt, travelBusy, onCancelTravel, onConfirmTravel,
  // The drag itself
  placement, ghost,
  // Create menu and the modals it opens
  createMenuOpen, onCloseCreateMenu, onSelectCreate,
  activeModal, selectedDay, selectedDateKey, prefillTime, prefillMinutes, businessHours,
  staffMembers, defaultStaffId, onCloseModal,
  onBookingSaved, onBlockSaved,
  // Blocked time, opened from its own card
  blockEdit, blockDelete, onCloseBlockEdit, onBlockChanged,
}) {
  return (
    <>
      {/* Outside the Booking Window — warn, and require an authorised override */}
      {windowPrompt && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-xl bg-white border border-amber-500/30 shadow-xl flex items-center gap-4 max-w-md">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-amber-700">Outside the booking window</p>
            <p className="text-[10px] text-zinc-500 mt-0.5">{windowPrompt.message}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={onCancelWindowOverride} className="text-xs font-semibold text-zinc-500 hover:text-zinc-900 px-3 py-1.5 rounded-lg hover:bg-zinc-50 transition-colors">Cancel</button>
            <button onClick={onConfirmWindowOverride} className="text-xs font-bold text-amber-700 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 px-3 py-1.5 rounded-lg transition-colors">Schedule Anyway</button>
          </div>
        </div>
      )}

      {/* Travel that cannot be achieved — the facts, and the barber's decision */}
      <TravelWarningDialog
        prompt={travelPrompt}
        busy={travelBusy}
        onCancel={onCancelTravel}
        onConfirm={onConfirmTravel}
      />

      <PlacementGhost request={placement?.request} ghost={ghost} hover={placement?.hover} />

      {createMenuOpen && (
        <CreateMenu onClose={onCloseCreateMenu} onSelect={onSelectCreate} />
      )}
      {activeModal === 'booking' && (
        <CreateBookingModal
          selectedDateKey={selectedDateKey}
          prefillTime={prefillTime}
          prefillDurationMins={prefillMinutes}
          staffMembers={staffMembers}
          defaultStaffId={defaultStaffId}
          onClose={onCloseModal}
          onSaved={onBookingSaved}
        />
      )}
      {activeModal === 'block' && (
        <BlockTimeModal
          selectedDay={selectedDay}
          selectedDateKey={selectedDateKey}
          businessHours={businessHours}
          prefillTime={prefillTime}
          prefillMinutes={prefillMinutes}
          onClose={onCloseModal}
          onSaved={onBlockSaved}
        />
      )}

      {/* Blocked time's own two actions — edit, or remove with its time handed back */}
      {blockEdit && (
        <BlockTimeEditDialog
          appt={blockEdit}
          onClose={onCloseBlockEdit}
          onSaved={onBlockChanged}
        />
      )}
      {blockDelete && (
        <BlockTimeDeleteDialog
          appt={blockDelete}
          onClose={onCloseBlockEdit}
          onDeleted={onBlockChanged}
        />
      )}
    </>
  );
}