// CV-2: a larger look at a chat's pasted images, one at a time, with Previous and Next (and the arrow keys) through
// every image loaded in that conversation; Esc or the backdrop closes it. The images come only from FocusTime's own
// address (the server checks the viewer is in the chat); nothing here downloads, shares or opens them elsewhere.
import { useEffect, useRef } from "react";

export type ViewerImage = { id: number; src: string };

export function ImageViewer({ images, at, onAt, onClose }: { images: readonly ViewerImage[]; at: number; onAt: (i: number) => void; onClose: () => void }) {
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => closeBtn.current?.focus(), []);
  const n = images.length;
  const img = images[Math.min(Math.max(at, 0), n - 1)];
  if (!img) return null;
  const go = (d: number) => onAt((at + d + n) % n);
  return (
    <div className="command-backdrop image-viewer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="image-viewer"
        data-overlay="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Image ${at + 1} of ${n}`}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") (e.preventDefault(), onClose());
          else if (e.key === "ArrowRight" && n > 1) (e.preventDefault(), go(1));
          else if (e.key === "ArrowLeft" && n > 1) (e.preventDefault(), go(-1));
        }}
      >
        <div className="image-viewer-bar">
          <span className="muted">
            Image {at + 1} of {n}
          </span>
          <button ref={closeBtn} type="button" className="mini quiet" onClick={onClose}>
            Close
          </button>
        </div>
        <img className="image-viewer-img" src={img.src} alt={`Image ${at + 1} of ${n} from the chat`} />
        {n > 1 && (
          <div className="image-viewer-nav">
            <button type="button" className="mini" onClick={() => go(-1)}>
              ‹ Previous
            </button>
            <button type="button" className="mini" onClick={() => go(1)}>
              Next ›
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
