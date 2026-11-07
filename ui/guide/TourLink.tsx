// G1: the link into the Guide on the sign-in page and once on a person's first Today (with Not now). Its own file so
// the main bundle doesn't load the Guide (UI-5: the Guide and its tours load lazily).
import { TOUR } from "./content.ts";

export function TourLink({ onOpen, onDismiss }: { onOpen: () => void; onDismiss?: () => void }) {
  return (
    <div className="guide-tour" role={onDismiss ? "status" : undefined}>
      <button type="button" className="link-btn" onClick={onOpen}>
        {TOUR.link}
      </button>
      {onDismiss && (
        <button type="button" className="quiet" onClick={onDismiss}>
          {TOUR.dismiss}
        </button>
      )}
    </div>
  );
}
