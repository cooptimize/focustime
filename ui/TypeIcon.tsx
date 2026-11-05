// WT-1: one icon per work item type, in place of type words. FocusTime's own drawings keyed by the DevOps icon id
// (icon_crown, icon_book, ...), filled with the type's color from the client's project, 14 to 16 px (it follows the
// text size inside that range), the type name as tooltip and accessible name. Never an image from a DevOps URL.
// Tracked replies and anything posted to Teams stay text only; this is only for FocusTime's own screens.
import { useContext } from "react";
import type { TypeLook } from "../week/types.ts";
import { DevOpsWork } from "./work.ts";

/** 16 × 16 drawings. Each is one or more filled paths (fill-rule evenodd), simple enough to read at 14 px. */
export const TYPE_ICONS: Record<string, string[]> = {
  // Epic (and Domain in some processes)
  icon_crown: ["M1.5 4.5 5 8l3-5 3 5 3.5-3.5L13 12.5H3z", "M3 13.5h10V15H3z"],
  // Feature
  icon_trophy: ["M4 1.5h8v4.5a4 4 0 0 1-8 0zM1.5 2.5H4V6A2.5 2.5 0 0 1 1.5 3.5zM14.5 2.5H12V6a2.5 2.5 0 0 0 2.5-2.5z", "M7 10h2v2.5H7zM4.5 12.5h7V15h-7z"],
  // User Story
  icon_book: ["M2 2.5C4 1.5 6 1.5 7.5 3v11C6 12.5 4 12.5 2 13.5zM14 2.5c-2-1-4-1-5.5.5v11c1.5-1.5 3.5-1.5 5.5-.5z"],
  // Product Backlog Item, Requirement
  icon_list: ["M2 3h2v2H2zM6 3h8v2H6zM2 7h2v2H2zM6 7h8v2H6zM2 11h2v2H2zM6 11h8v2H6z"],
  // Task
  icon_clipboard: ["M5.5 1h5v2h2.5v12H3V3h2.5zM7 2.5v1h2v-1zM5 6.5h6V8H5zm0 3h6V11H5z"],
  // Bug
  icon_insect: ["M5.5 3a2.5 2.5 0 0 1 5 0zM4 4.5h8v4a4 4 0 0 1-8 0z", "M1 6h3v1.3H1zM12 6h3v1.3h-3zM1 9.5h3v1.3H1zM12 9.5h3v1.3h-3zM2 13l2.2-2 .9.9-2.2 2zM14 13l-2.2-2-.9.9 2.2 2z"],
  // Recurring (Cooptimize), Project Issue
  icon_asterisk: ["M7 1h2v4.3l3.7-2.2 1 1.7L10 7l3.7 2.2-1 1.7L9 8.7V15H7V8.7l-3.7 2.2-1-1.7L6 7 2.3 4.8l1-1.7L7 5.3z"],
  // Ongoing (Cooptimize), Risk
  icon_flame: ["M8 1c.5 3 4.5 4.5 4.5 8.5a4.5 4.5 0 0 1-9 0C3.5 7 5 5.5 5.5 4c.8 1.5 1.5 2 2.2 2.3C7.3 4.5 7.4 2.6 8 1zm0 8.2c-1 1-1.6 1.9-1.6 3a1.6 1.6 0 0 0 3.2 0c0-1.1-.6-2-1.6-3z"],
  // Decision
  icon_gavel: ["M6.2 1.3 10.6 5.7 8.7 7.6 4.3 3.2zM9.4 6.9l4.9 4.9-1.5 1.5-4.9-4.9zM1.5 13h7v2h-7z"],
  // Action Item
  icon_parachute: ["M1 7a7 6 0 0 1 14 0zM2 8l5 4.5h-1L1.5 8.6zM14 8l-5 4.5h1l4.5-3.9zM7.3 8h1.4v4.5H7.3z", "M6 12.5h4V15H6z"],
  // Change Request, Report
  icon_chart: ["M1.5 14h13v1.5h-13zM2.5 9h2.5v4H2.5zM6.75 5H9.25v8H6.75zM11 2h2.5v11H11z"],
  // Issue
  icon_traffic_cone: ["M6.5 1h3l.7 3H5.8zM5.4 5.5h5.2l.7 3H4.7zM4.3 10h7.4l.8 3H3.5zM1.5 13.5h13V15h-13z"],
  // Dependency, Q Business Process
  icon_diamond: ["M8 1 15 8 8 15 1 8z"],
  // Assumption
  icon_palette: ["M8 1.5a6.5 6.5 0 0 0 0 13c1 0 1.5-.6 1.5-1.3 0-1-.9-1.2-.9-2s.6-1.2 1.4-1.2h1.5a3 3 0 0 0 3-3C14.5 3.8 11.6 1.5 8 1.5zM4.5 6.5a1.2 1.2 0 1 1 0 .01zm2.5-2.5a1.2 1.2 0 1 1 0 .01zm3.5.5a1.2 1.2 0 1 1 0 .01z"],
  // Action (W&C)
  icon_megaphone: ["M1.5 6h3l7-4v12l-7-4h-3zM4.5 10.5h2L7.5 15H5.5zM13 6.5h2v3h-2z"],
  // Deliverable
  icon_check_box: ["M2 2h12v12H2zm1.5 1.5v9h9v-9zM4.6 7.7l1.1-1.1L7.3 8.2l3.1-3.1 1.1 1.1-4.2 4.2z"],
  // Configuration
  icon_gear: ["M6.8 1h2.4l.4 2 1.4.6 1.7-1.1 1.7 1.7-1.1 1.7.6 1.4 2 .4v2.4l-2 .4-.6 1.4 1.1 1.7-1.7 1.7-1.7-1.1-1.4.6-.4 2H6.8l-.4-2-1.4-.6-1.7 1.1-1.7-1.7 1.1-1.7-.6-1.4-2-.4V6.8l2-.4.6-1.4-1.1-1.7 1.7-1.7 1.7 1.1 1.4-.6zM8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"],
  // Data Migration
  icon_database_storage: ["M2.5 3.5C2.5 2 5 1 8 1s5.5 1 5.5 2.5S11 6 8 6 2.5 5 2.5 3.5zM2.5 5.5C3.8 6.8 5.8 7.4 8 7.4s4.2-.6 5.5-1.9V8c0 1.5-2.5 2.5-5.5 2.5S2.5 9.5 2.5 8zM2.5 10c1.3 1.3 3.3 1.9 5.5 1.9s4.2-.6 5.5-1.9v2.5C13.5 14 11 15 8 15s-5.5-1-5.5-2.5z"],
  // ERP Support Ticket
  icon_headphone: ["M8 1.5A6.5 6.5 0 0 0 1.5 8v5.5h4V9h-2.3V8a4.8 4.8 0 0 1 9.6 0v1h-2.3v4.5h4V8A6.5 6.5 0 0 0 8 1.5z"],
  // Test Case, Test Plan, Test Suite, Shared Steps, Shared Parameter
  icon_test_case: ["M5.5 1h5v1.5H10V6l4 7.5A1.2 1.2 0 0 1 13 15H3a1.2 1.2 0 0 1-1-1.5L6 6V2.5h-.5zM5 10l-1.6 3.5h9.2L11 10z"],
  // Code Review, Feedback (request and response), Question
  icon_code_review: ["M1.5 2h13v9H7l-3.5 3v-3h-2zM4 5.5h8V7H4zm0-2h8V5H4zm0 4h5V9H4z"],
};
// The rest of the DevOps set used in our projects, drawn with the nearest of the above.
const SAME: Record<string, string> = {
  icon_test_plan: "icon_test_case", icon_test_suite: "icon_test_case", icon_test_step: "icon_test_case", icon_test_parameter: "icon_test_case",
  icon_code_response: "icon_code_review", icon_review: "icon_code_review", icon_response: "icon_code_review",
  icon_sticky_note: "icon_clipboard", icon_star: "icon_diamond", icon_trophy_2: "icon_trophy",
};
/** The neutral fallback: a plain dot (never a square that reads as a checkbox) for a type FocusTime doesn't draw. */
const FALLBACK = ["M8 4.25a3.75 3.75 0 1 1 0 7.5 3.75 3.75 0 0 1 0-7.5z"];

/** The paths for a DevOps icon id, or the fallback. */
export const iconPaths = (id: string | null | undefined): { paths: string[]; known: boolean } => {
  const key = id ? (TYPE_ICONS[id] ? id : SAME[id]) : undefined;
  return key && TYPE_ICONS[key] ? { paths: TYPE_ICONS[key], known: true } : { paths: FALLBACK, known: false };
};

/** A type's look from the client's last DevOps read (exact client key only), or null when it isn't known. */
export function useTypeLook(clientKey: string | null | undefined, type: string | null | undefined): TypeLook | null {
  const work = useContext(DevOpsWork);
  if (!clientKey || !type) return null;
  return work.get(clientKey)?.types?.find((t) => t.name === type) ?? null;
}

const HEX = /^[0-9a-f]{6}$/i;

/**
 * The icon for a work item type. Give it the client and the type name (looked up in the client's process), or a look.
 * The name is the tooltip and the accessible name; pass `decorative` where the name is already written next to it.
 */
export function TypeIcon({ clientKey, type, look, decorative = false, className }: { clientKey?: string | null; type: string; look?: Pick<TypeLook, "icon" | "color"> | null; decorative?: boolean; className?: string }) {
  const found = useTypeLook(clientKey, type);
  const l = look ?? found;
  const { paths, known } = iconPaths(l?.icon);
  const color = l?.color && HEX.test(l.color) ? `#${l.color}` : undefined;
  const name = type || "Work item";
  return (
    <span className={`type-icon${known ? "" : " type-icon-fallback"}${className ? ` ${className}` : ""}`} title={decorative ? undefined : name} data-type={name}>
      <svg viewBox="0 0 16 16" width="1em" height="1em" fill={color ?? "currentColor"} fillRule="evenodd" {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": name })} focusable="false">
        {paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </span>
  );
}

/** The small marker on an item DevOps has resolved (no hours left, not closed). */
export function ResolvedMark({ state }: { state?: string | null }) {
  return (
    <span className="resolved-mark" title={state ? `${state} in DevOps: no hours left` : "Resolved in DevOps: no hours left"}>
      Resolved
    </span>
  );
}
