// AH-5: a choice behind a button (filters), the app's own instead of a native select: the button shows the current
// choice; it opens a filterable list in a popover; a pick applies at once.
import { useRef, useState } from "react";
import { CellPopover, FilterList, type ListOption } from "./CellPopover.tsx";
import { Icon } from "./icons.tsx";

export function SelectField({ label, value, options, onChange, className = "", empty = "Any" }: { label: string; value: string; options: readonly ListOption[]; onChange: (key: string) => void; className?: string; /** What it says with nothing chosen. */ empty?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const close = () => (setOpen(false), requestAnimationFrame(() => btn.current?.focus()));
  const cur = options.find((o) => o.key === value);
  return (
    <>
      <button ref={btn} type="button" className={`date-field select-field ${className}`} aria-label={`${label}: ${cur?.label ?? empty}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{cur?.label ?? empty}</span>
        <span className="date-field-icon"><Icon name="open" /></span>
      </button>
      {open && (
        <CellPopover anchor={btn.current} title={label} onSave={close} onCancel={close} saveLabel="Done" className="ah-pop-list">
          <FilterList label={label} options={options} current={value} filter={options.length > 8} onPick={(k) => (onChange(k), close())} />
        </CellPopover>
      )}
    </>
  );
}
