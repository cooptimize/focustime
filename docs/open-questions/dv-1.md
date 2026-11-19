## DevOps polling (DV-1, Nov 5)

- Q-DV1-1: `pollAccounts()` decides which clients are polled from people_clients and recent asks; it should be ADM-2's `clientAccounts()` once that merges (the TODO in `actions/devops-poll.ts`).
- Q-DV1-2: The Rule "DevOps check interval" isn't in Admin's form; the step that owns Admin's screens adds the field (the spec is in `config/org.ts`).
- Q-DV1-3: The old per-person DevOps snapshot files are no longer written but still on disk. Delete them in a later release, once DV-1 has run on prod a while.
- Q-DV1-4: Is 1 minute right in hours? Dev's Status rows show calls today and each call's TSTU cost; check them after a full working day before prod.
- Q-DV1-5: An item read once by id (a parent outside the scope, an item on demand) stays in the store until the reconcile drops it. Should on-demand reads get their own expiry?

- Q-ADM2-1: `org.retention_years` is shown in Status as "Not enforced yet". Nothing deletes old data; a delete job (which tables, per person, oldest first, a notice first or not) is a later step.
- Q-ADM2-2: Guests are told apart from the ID token's `idp` and the UPN today. The `acct` optional claim (0 member, 1 guest) is the documented signal but must be added to the app registration's optional claims (`infra/scripts/`, an Azure change). Worth adding in the next infra step. Answered (HK-1, D612): `infra/scripts/app-registration.sh --claims-only` adds acct to the ID token; `guestToken` already reads it first.
- Q-ADM2-3: The automation flag isn't prefilled for the known automation account (no migration can read Dataverse, and naming a person in code is ruled out). An admin sets it once in Admin › People after the merge.
- Q-ADM2-4: Resolved by CV-2 (D620): `ui/nav.ts` takes hyphenated section names; a test opens all 7 Admin sections by address.

