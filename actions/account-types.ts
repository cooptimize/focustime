// Step 15.4: the shapes the UI sees for the sign-in and my VM (types only; no I/O, safe to import in the window).
import type { PowerState, Shutdown, VmChip, VmOp, VmTransition } from "../plan/vm.ts";

export type Person = { name: string; username: string; initials: string };
export type AuthStatus = {
  /** Whether a Microsoft app registration is set up ([outlook] client_id). Without one there's no sign-in screen. */
  configured: boolean;
  /** signed_out shows the sign-in screen; unavailable (offline, keyring locked) keeps working with who was signed in. */
  state: "signed_in" | "signed_out" | "unavailable";
  person: Person | null;
  message: string | null;
  /** R1: the one-time keyring move from Coopilot failed; what to do (no secret, no value). */
  renameNote?: string | null;
};

/** My VM, kept per signed-in person (their object id), in account state. */
export type ChosenVm = { id: string; name: string; resourceGroup: string; subscriptionId: string; location: string; chosenAt: string };

/** D475: start is the only VM change FocusTime makes. */
export type VmPreviewOp = VmOp;
export type VmPreview = {
  previewId: string;
  expiresAt: string;
  op: VmPreviewOp;
  title: string;
  vm: string;
  lines: { label: string; before: string; after: string }[];
  notes: string[];
  /** Shown prominently (none today). */
  warning: string | null;
  confirmLabel: string;
};

export type VmError = { kind: string; message: string; permission: string | null };
export type VmStatus = {
  signedIn: boolean;
  vm: ChosenVm | null;
  chip: VmChip | null;
  label: string | null;
  /** Step 16.3: the header chip's line, "Running · off at 7:30 PM". */
  text: string | null;
  power: PowerState | null;
  transition: VmTransition | null;
  canStart: boolean;
  /** The auto-shutdown schedule as Azure has it, read only (D475: FocusTime never changes it). */
  schedule: { label: string; time: string; status: Shutdown["status"]; timeZoneId: string } | null;
  /** "Your VM is off. Start it?" */
  prompt: boolean;
  /** Step 15.5 (Q87): the prompt's Start runs at once (Settings > You), else it shows the preview. */
  startWithoutAsking: boolean;
  refreshMs: number;
  /** Azure needs an incremental consent (Allow Azure access). */
  needsConsent: boolean;
  error: VmError | null;
};

/** One Azure write: a start. Older rows may be a deallocate, an auto-shutdown change or its restore (before D475). */
export type AzureWriteEntry = {
  id: number;
  at: string;
  op: "start" | "deallocate" | "shutdown_change" | "shutdown_restore";
  vmId: string;
  vmName: string;
  before: unknown;
  after: unknown;
  status: "pending" | "confirmed" | "failed" | "timed_out" | "refused";
  message: string | null;
  auto: boolean;
  attempts: number;
  updatedAt: string;
};

/** One change to my Teams status during focus (step 16.3): set (Busy or Do not disturb, for minutes), clear, or left as I set it in Teams. */
export type TeamsStatusEntry = {
  id: number;
  at: string;
  op: "set" | "clear" | "left";
  status: "Busy" | "DoNotDisturb" | null;
  minutes: number | null;
  result: "done" | "failed";
  message: string | null;
};
