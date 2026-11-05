// S1 (D452): ⋯ › About. One line: "FocusTime · dev · #8 · abc1234 · built Nov 3, 12:05 PM" (the time in the person's
// zone; a local build is "FocusTime · local · abc1234"), with links to the PR and the commit on GitHub, Copy, and the
// Guide. Nothing else. The facts come from /version (env, PR, sha, build time; no secrets, hostnames or user data).
import { CloseButton, useReturnFocus } from "./CloseButton.tsx";
import { useEffect, useRef, useState } from "react";

export type Build = { env: string; pr: string; sha: string; builtAt: string | null };
export const REPO = "https://github.com/cooptimize/focustime";

/** The About line, as text (Copy copies exactly this). */
export function aboutLine(b: Build, zone: string): string {
  const parts = ["FocusTime", b.env];
  if (b.env !== "local" && /^\d+$/.test(b.pr)) parts.push(`#${b.pr}`);
  parts.push(b.sha);
  if (b.env !== "local" && b.builtAt) {
    const at = Temporal.Instant.from(b.builtAt).toZonedDateTimeISO(zone);
    parts.push(`built ${at.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`);
  }
  return parts.join(" · ");
}

export function AboutDialog({ zone, onClose, onGuide }: { zone: string; onClose: () => void; onGuide: () => void }) {
  const [build, setBuild] = useState<Build | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const close = useRef<HTMLButtonElement>(null);
  useReturnFocus();
  useEffect(() => {
    close.current?.focus();
    fetch("/version", { credentials: "same-origin" })
      .then((r) => (r.ok ? (r.json() as Promise<Build>) : Promise.reject(new Error(`${r.status}`))))
      .then(setBuild, () => setError("The version couldn't be read just now"));
  }, []);
  const line = build ? aboutLine(build, zone) : null;
  const known = build && /^[0-9a-f]{7}$/.test(build.sha);
  return (
    <div className="command-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="command-menu about-dialog"
        data-overlay="modal"
        role="dialog"
        aria-label="About FocusTime"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      >
        <div className="command-head">
          <span className="command-step-title">About</span>
          <CloseButton buttonRef={close} onClose={onClose} />
        </div>
        <p className="about-line">
          {error ??
            (build && line ? (
              <>
                FocusTime · {build.env}
                {build.env !== "local" && /^\d+$/.test(build.pr) && (
                  <>
                    {" · "}
                    <a href={`${REPO}/pull/${build.pr}`} target="_blank" rel="noreferrer" title="The pull request on GitHub">
                      #{build.pr}
                    </a>
                  </>
                )}
                {" · "}
                {known ? (
                  <a href={`${REPO}/commit/${build.sha}`} target="_blank" rel="noreferrer" title="The commit on GitHub">
                    {build.sha}
                  </a>
                ) : (
                  build.sha
                )}
                {line.includes(" · built ") && ` · ${line.slice(line.indexOf("built "))}`}
              </>
            ) : (
              "…"
            ))}
        </p>
        <div className="about-actions">
          <button
            type="button"
            className="mini"
            disabled={!line}
            onClick={() => {
              if (!line) return;
              void navigator.clipboard?.writeText(line).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <a
            href="#/guide"
            onClick={(e) => {
              e.preventDefault();
              onClose();
              onGuide();
            }}
          >
            Guide
          </a>
        </div>
      </div>
    </div>
  );
}
