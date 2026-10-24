import React from 'react';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';

// The app's own confirmation for a merge. It replaces window.confirm, which blocks the
// page and was the only thing between one click and a bulk rewrite of bookings.
// `ask` is { keep, dup } or null.
export default function MergeClientsDialog({ ask, busy, onCancel, onConfirm }) {
  return (
    <AlertDialog open={!!ask} onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <AlertDialogContent className="bg-white text-zinc-900">
        <AlertDialogHeader>
          <AlertDialogTitle>Merge these clients?</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2 text-zinc-600">
            <span className="block">
              <strong>{ask?.dup?.client_name}</strong> will be merged into <strong>{ask?.keep?.client_name}</strong>, and the duplicate record removed.
            </span>
            <span className="block">
              Only bookings linked to the duplicate are moved. Finished bookings keep the phone and email they were taken with.
              Records with different phone numbers are refused.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); onConfirm(); }}>
            {busy ? 'Merging…' : 'Merge clients'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}