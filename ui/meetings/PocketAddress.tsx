// PK-4: Set my Pocket address, from Calls' left-out line. I type the address my Pocket account uses; the server
// accepts it only when it is the recorder on a recording Pocket just listed for my key, and refuses anything else in
// the same words. Nothing is offered to choose from: FocusTime never lists other people's names or addresses.
import { useState } from "react";
import { ActionRefusal, call } from "../api.ts";
import { POCKET_CALL_WORDS as PW } from "../../plan/pocket-words.ts";

const errText = (e: unknown) => (e instanceof ActionRefusal || e instanceof Error ? e.message : "Something went wrong");

export function PocketAddressForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await call("meeting.pocket_address_add", { address: value });
      onSaved();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="pocket-address" data-pocket-address="" onSubmit={(e) => (e.preventDefault(), void save())}>
      <label>
        <span>{PW.addressLabel}</span>
        <input type="email" autoComplete="email" inputMode="email" spellCheck={false} required maxLength={320} value={value} onChange={(e) => setValue(e.target.value)} autoFocus aria-describedby="pocket-address-hint" />
      </label>
      <p id="pocket-address-hint" className="muted">{PW.addressHint}</p>
      {err && <p className="error-line" role="alert">{err}</p>}
      <span className="pocket-address-acts">
        <button type="submit" className="mini primary" disabled={busy || !value.trim()}>{PW.addressSave}</button>
        <button type="button" className="mini quiet" onClick={onCancel}>{PW.addressCancel}</button>
      </span>
    </form>
  );
}
