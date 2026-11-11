// The short ID of an item: "GB-12". The server gives every item a number, in
// order, starting at 1. A number is never reused and never changes. The ID is
// that number behind a prefix, so a person can say it or type it.
//
// The prefix is set here and nowhere else. The scripts read it from the export.

/** "GB" for give-back. Letters only. */
export const ITEM_ID_PREFIX = "GB";

/** Largest number an ID is read as. Far above what the dashboard holds; it keeps a typed number exact. */
export const MAX_ITEM_NUMBER = 9_999_999;

const ITEM_ID_PATTERN = new RegExp(`^${ITEM_ID_PREFIX}-([1-9][0-9]{0,6})$`, "i");

export function isItemNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_ITEM_NUMBER;
}

/** 12 → "GB-12". */
export function formatItemId(number: number): string {
  return `${ITEM_ID_PREFIX}-${number}`;
}

/** The ID of an item, or null for an item that has no number yet. */
export function itemIdOf(item: { number?: number | null }): string | null {
  return isItemNumber(item.number) ? formatItemId(item.number) : null;
}

/**
 * "GB-12", "gb-12" → 12. Null for anything else: no prefix, a zero, a leading
 * zero, or text around the ID. Surrounding spaces are ignored.
 */
export function parseItemId(text: string): number | null {
  if (typeof text !== "string") return null;
  const match = ITEM_ID_PATTERN.exec(text.trim());
  return match ? Number(match[1]) : null;
}
