// PH-1: the Desktop version's way back. The only piece of the phone's shell the Desktop version shows: a small button
// held at the screen's corner at the same size on screen however far the page is zoomed out or pinched (the visual
// viewport's scale and offset, MDN's "simulating position: device-fixed").
import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { PHONE_VERSION_TEXT } from "./desktop-version.ts";

export function PhoneVersionButton({ onBack }: { onBack: () => void }) {
  const [place, setPlace] = useState<CSSProperties>({});
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const on = () => {
      // CSS px per screen px: 1280 laid out on a 390 wide screen is about 3.3.
      const k = Math.max(1, vv.width / Math.max(1, screen.width || vv.width));
      setPlace({ left: vv.pageLeft + vv.width - 12 * k, top: vv.pageTop + vv.height - 12 * k, transform: `translate(-100%, -100%) scale(${k})`, transformOrigin: "100% 100%" });
    };
    on();
    vv.addEventListener("resize", on);
    vv.addEventListener("scroll", on);
    return () => {
      vv.removeEventListener("resize", on);
      vv.removeEventListener("scroll", on);
    };
  }, []);
  // In the body, outside the app's own layers, so nothing the page draws can cover the way back.
  return createPortal(
    <button type="button" className="phone-version" style={place} onClick={onBack} aria-label={PHONE_VERSION_TEXT.label}>
      {PHONE_VERSION_TEXT.button}
    </button>,
    document.body,
  );
}
