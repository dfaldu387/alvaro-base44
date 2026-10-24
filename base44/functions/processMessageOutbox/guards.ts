// The recipient check now lives in shared/recipientGuard.ts (unchanged) so the dead-letter
// re-queue uses the very same consent check. The sweep keeps importing it from here.
export { recipientBlock } from '../../shared/recipientGuard.ts';