// Test-data classification — shared by every backend function so the rule
// lives in exactly one place.
//
// A booking is test data when either:
//   • the explicit manual test flag was set (admin/testing interfaces only), or
//   • the customer's last name is exactly TEST in capitals (whitespace-safe).
//
// Production queries use excludeTestQuery() so test data is filtered out on the
// server, never only hidden in the UI.

export const TEST_LAST_NAME = 'TEST';

// Last name EXACTLY "TEST" in capitals — trims and collapses whitespace. A
// single-word name counts as the last name. Deliberately case-sensitive:
// "Test", "test", "TESTING" and "Testa" are all ordinary names.
export function isTestLastName(fullName?: string | null): boolean {
  const name = String(fullName || '').trim();
  if (!name) return false;
  const parts = name.split(/\s+/);
  return parts[parts.length - 1] === TEST_LAST_NAME;
}

// Authoritative classification: manual test flag OR last name TEST.
// Frontend values are never trusted for the automatic rule.
export function resolveIsTest(manualFlag: unknown, fullName?: string | null): boolean {
  return manualFlag === true || isTestLastName(fullName);
}

// Query fragment for production metrics. Records without the field are real
// (is_test != true), so existing data is never misclassified.
export function excludeTestQuery(): { is_test: { $ne: boolean } } {
  return { is_test: { $ne: true } };
}