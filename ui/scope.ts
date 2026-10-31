// Tab scope (step 6.1): only the selected half-day's items and menus are in the Tab order; the rest of the week
// is reached with the arrow keys. Components inside a half-day ask for their tabIndex here.
import { createContext, useContext } from "react";

/** True inside the selected half-day, and everywhere outside the week grid. */
export const HalfScope = createContext(true);

/** undefined (normal Tab order) in scope, -1 (click and arrow keys only) out of it. */
export const useScopedTab = (): -1 | undefined => (useContext(HalfScope) ? undefined : -1);
