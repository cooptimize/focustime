// UI-10: the one multi-line text box. It starts at `minRows` lines (one by default), grows with its text up to
// `maxRows` (six by default), then scrolls inside with a thin styled scrollbar that shows only while there is something
// to scroll. No resize handle, no native arrows, and its width is the layout's, never the content's.
import { useCallback, useEffect, useLayoutEffect, useRef, type KeyboardEvent, type Ref, type TextareaHTMLAttributes } from "react";
import { boxSize, lineHeightPx, submitsOnEnter } from "./textbox.ts";

export type TextBoxProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "rows"> & {
  /** The lines it starts at (1). A field meant to be taller, like a message, starts higher. */
  minRows?: number;
  /** The lines it grows to before it scrolls (6). */
  maxRows?: number;
  /** Enter (not Shift+Enter, not while composing) calls this instead of adding a line. Leave it out to keep Enter a new line. */
  onEnter?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  ref?: Ref<HTMLTextAreaElement>;
};

function setRef<T>(ref: Ref<T> | undefined, v: T | null): void {
  if (typeof ref === "function") ref(v);
  else if (ref) (ref as { current: T | null }).current = v;
}

export function TextBox({ minRows = 1, maxRows = 6, onEnter, onKeyDown, className, ref, value, ...rest }: TextBoxProps) {
  const el = useRef<HTMLTextAreaElement | null>(null);
  const fit = useCallback(() => {
    const t = el.current;
    if (!t) return;
    const cs = getComputedStyle(t);
    const lh = lineHeightPx(cs.lineHeight, cs.fontSize);
    const paddingY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const borderY = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    // Measure at the smallest height, with no scrollbar taking width, so the text wraps as it will when it fits.
    t.style.overflowY = "hidden";
    t.style.height = `${minRows * lh + paddingY + borderY}px`;
    const s = boxSize({ scrollHeight: t.scrollHeight, lineHeight: lh, paddingY, borderY }, minRows, maxRows);
    t.style.height = `${s.height}px`;
    t.style.overflowY = s.scrolls ? "auto" : "hidden";
    t.dataset.scrolls = s.scrolls ? "true" : "false";
  }, [minRows, maxRows]);
  useLayoutEffect(fit, [fit, value]);
  // Text size, the theme's font or the panel's width can rewrap the text: fit again.
  useEffect(() => {
    const t = el.current;
    if (!t) return;
    let w = t.clientWidth;
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      if (t.clientWidth !== w) (w = t.clientWidth), fit();
    });
    ro?.observe(t);
    const mo = new MutationObserver(fit);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-text-size", "data-theme"] });
    return () => (ro?.disconnect(), mo.disconnect());
  }, [fit]);
  return (
    <textarea
      {...rest}
      value={value}
      rows={minRows}
      ref={(v) => ((el.current = v), setRef(ref, v))}
      className={`text-box${className ? ` ${className}` : ""}`}
      onInput={(e) => (fit(), rest.onInput?.(e))}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (!onEnter || e.defaultPrevented) return;
        if (submitsOnEnter({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode })) {
          e.preventDefault();
          onEnter(e);
        }
      }}
    />
  );
}
