import { useRef } from 'react';

/**
 * One submission token for the life of a mounted modal. Every retry of a save sends
 * the same token (so the server returns the original booking); closing and reopening
 * the modal mounts it again and gets a new one (so a second appointment is created).
 */
export default function useSubmissionToken() {
  const ref = useRef(null);
  if (!ref.current) ref.current = (globalThis.crypto?.randomUUID?.() || `t-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return ref.current;
}