import React from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export default function LiveConfirmDialog({ open, busy, onCancel, onConfirm }) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Switch messaging to Live?</AlertDialogTitle>
          <AlertDialogDescription>
            Every customer will now receive automated messages: request received, booking confirmed,
            arrival times, changes, cancellations, no-show follow-ups and reminders. Real text messages
            will go to real people. Your name and the time will be recorded.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); onConfirm(); }} className="bg-red-600 hover:bg-red-700">
            {busy ? 'Switching…' : 'Yes, message every customer'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}