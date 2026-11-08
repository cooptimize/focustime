// SR-1: what status.load answers, as the UI reads it. Pure types: no author email ever appears here.
import type { FeatureWhy, ReportComment, ReportWindow } from "./status-report.ts";
import type { IsoDate } from "../week/types.ts";

/** One comment as Status shows it: never its author's email. */
export type StatusComment = { id: number; text: string; author: string; at: string; who: ReportComment["who"]; editable: boolean };
export type StatusFeature = {
  id: number; title: string; type: string; state: string; url: string; why: FeatureWhy;
  /** This window's comments (Monday's bullets) and last week's, oldest first; null when DevOps couldn't be read. */
  thisWeek: StatusComment[] | null; lastWeek: StatusComment[];
  /** The facts a draft is built from, as plain lines (shown under the box when AI is off). */
  hints: string[];
};
export type StatusClient = {
  clientKey: string; clientName: string;
  /** "ok", or why the client's items couldn't be read (the message says so). */
  status: "ok" | "error"; message?: string;
  window: ReportWindow & { note: string | null };
  canWrite: boolean;
  /** AI for this client: ok, or why not ("off", "client_off", "not_set_up"). */
  ai: "ok" | "off" | "client_off" | "not_set_up"; aiNote: string | null;
  features: StatusFeature[]; also: StatusFeature[];
};
export type StatusLoad = {
  /** The Monday the report goes out (ET), and "for Monday, Nov 9". */
  reportDate: IsoDate; title: string; sends: string;
  counts: { features: number; withUpdate: number; without: number }; countLine: string;
  clients: StatusClient[];
};


// ---- SR-2: the client's report, visible to the whole team ----

/** A client whose report I can open: I'm on its team (an Account Worker or a lead, and a Cooptimizer). */
export type ReportClientRef = { clientKey: string; clientName: string };
export type ReportFeature = StatusFeature & {
  /** The feature's assignee as DevOps shows it, or null. */
  owner: string | null;
};
export type NoUpdateFeature = ReportFeature & { active: "planned" | "activity" };
export type PtoSection =
  | { status: "ok"; rows: { name: string; when: string; days: number }[]; source: string; range: string }
  | { status: "error"; message: string; source: string };
export type StatusReport = {
  clientKey: string; clientName: string;
  /** The Monday the report goes out, and the header line. */
  reportDate: string; header: string;
  /** When comments start counting, and why (Kat's watermark, never sent, or unknown with the reason). */
  window: { since: string; source: "kat" | "never" | "unknown"; katSentAt: string | null; note: string | null };
  status: "ok" | "error"; message?: string;
  canWrite: boolean;
  /** Who a new line will show as in DevOps and the report: my write access's DevOps name. */
  authorAs: string | null;
  features: ReportFeature[];
  noUpdate: NoUpdateFeature[];
  pto: PtoSection;
  refreshedAt: string;
};
export type StatusReportAnswer = { clients: ReportClientRef[]; report: StatusReport | null };
