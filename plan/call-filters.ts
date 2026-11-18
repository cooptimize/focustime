// MC-4: Calls' list filters, on their own so the address code (in the first download) doesn't load the list's rules.
/** The list's filters, in order: what is still to do, what is finished, what I put out of the way. */
export const LIST_FILTERS = ["open", "closed", "hidden"] as const;
export type ListFilter = (typeof LIST_FILTERS)[number];
/** MC-3's filters in an address someone kept: To review and Not reviewed are in Open now, Done is Closed. */
export const OLD_FILTERS: Readonly<Record<string, ListFilter | null>> = { all: null, review: null, open: null, done: "closed" };
