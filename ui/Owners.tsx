// D460: who owns a story, where others own work. A 16 px round photo from the per-user photo cache (one batched read
// per view through usePhotos, never per row), initials in the same circle when there is none (someone outside the
// team, no photo, not read yet), so nothing shifts when a photo arrives. I am "you", with no photo.
import { createContext, useContext } from "react";
import { avatarStack, type Owner } from "../plan/rowdates.ts";
import { Avatar } from "./Presence.tsx";

/** The photo for an email, from the view's one usePhotos read; null: initials. */
export const OwnerPhotos = createContext<(email: string | null | undefined) => string | null>(() => null);

const SIZE = 16;

/** "you", or a small photo (or initials) and the person's name. */
export function OwnerName({ name, email, mine }: { name: string | null; email?: string | null; mine: boolean }) {
  const photoFor = useContext(OwnerPhotos);
  if (mine) return <span className="owner">you</span>;
  if (!name) return <span className="owner">unassigned</span>;
  return (
    <span className="owner">
      <Avatar name={name} photo={photoFor(email)} size={SIZE} />
      {name}
    </span>
  );
}

/** Up to three overlapping avatars of other owners, then "+N"; the names in the tooltip. Nothing for none. */
export function OwnerStack({ owners }: { owners: readonly Owner[] }) {
  const photoFor = useContext(OwnerPhotos);
  if (!owners.length) return null;
  const { shown, more, names } = avatarStack(owners);
  return (
    <span className="owner-stack" title={names} aria-label={`Assigned to ${names}`} role="img">
      {shown.map((o) => (
        <Avatar key={o.email ?? o.name} name={o.name} photo={photoFor(o.email)} size={SIZE} />
      ))}
      {more > 0 && <span className="owner-more">+{more}</span>}
    </span>
  );
}
