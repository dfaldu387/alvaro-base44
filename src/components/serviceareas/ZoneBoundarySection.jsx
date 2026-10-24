import React from 'react';
import { Pencil, Eraser, Check, Plus } from 'lucide-react';
import SectionCard from './SectionCard';
import { validatePolygon, getPolygonCoords } from '@/lib/geometryUtils';

// Boundary section — shows polygon status and draw/edit/clear controls.
// The actual editing happens on the map; these buttons toggle the map's
// edit mode.
export default function ZoneBoundarySection({ draft, editMode, onEditModeChange, onClearGeometry, canEdit }) {
  const hasGeometry = draft?.geometry && validatePolygon(draft.geometry).valid;
  const vertexCount = hasGeometry ? getPolygonCoords(draft.geometry).length : 0;
  const isEditing = editMode === 'draw' || editMode === 'edit';

  return (
    <SectionCard title="Zone boundary" description="Draw or edit the polygon that defines this service zone on the map.">
      {/* Status badge */}
      <div>
        {hasGeometry ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Polygon drawn · {vertexCount} vertices
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            No polygon — using radius fallback
          </span>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {isEditing ? (
          <button
            onClick={() => onEditModeChange('select')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700"
          >
            <Check className="w-3.5 h-3.5" /> Done editing
          </button>
        ) : (
          <>
            <button
              onClick={() => onEditModeChange('draw')}
              disabled={!canEdit}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="w-3.5 h-3.5" /> {hasGeometry ? 'Redraw polygon' : 'Draw polygon'}
            </button>
            {hasGeometry && (
              <button
                onClick={() => onEditModeChange('edit')}
                disabled={!canEdit}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Pencil className="w-3.5 h-3.5" /> Edit vertices
              </button>
            )}
            {hasGeometry && (
              <button
                onClick={onClearGeometry}
                disabled={!canEdit}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Eraser className="w-3.5 h-3.5" /> Clear
              </button>
            )}
          </>
        )}
      </div>

      {/* Helper text */}
      {editMode === 'draw' && (
        <p className="text-xs text-violet-600 font-medium">
          Click on the map to add vertices. Double-click to finish. Press Esc to cancel.
        </p>
      )}
      {editMode === 'edit' && (
        <p className="text-xs text-violet-600 font-medium">
          Drag vertices to move. Click midpoint markers to add. Right-click a vertex to delete.
        </p>
      )}
      {!hasGeometry && !isEditing && (
        <p className="text-xs text-zinc-400">
          Without a polygon, this zone uses its centre point and radius for the map display.
        </p>
      )}
    </SectionCard>
  );
}