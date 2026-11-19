## ENV-1

- The focus timer still ends on time on a test site and its end shows in the page (the person pressed Start there); only its Web Push waits for the person's switch. Read as "the person started it", not as an unprompted notice. Should a test site's timer end be silent in the page too?
- Check now runs the AI pass when it finds a transcript, under the presser's switches and caps (a button press, for that person). Taken as allowed; say if a test site should store the transcript without the AI pass.
- An admin editing a client's names on a test site doesn't re-sort held messages (it spends AI on everyone's chats, not just the admin's). Held messages stay held there. Is a button for it wanted on dev?
- The retention purge still runs on dev, so dev's stored chat text and transcripts go after 14 and 30 days as the hard rules say. Read "what dev's database already holds stays" as "this step deletes nothing", not as "retention stops on dev". Confirm.
- VM-2 merged while this step was open. Its production check now comes from the policy's `vm_autostart` (never outside production), and its tick part and wake are skipped on a test site, which shows "production only" as VM-2 designed. VM-2's demo override (`FOCUSTIME_DEMO_AUTOSTART_ENV`) is unchanged.
- The Settings switch is hidden by `/version`'s env label, which is lowercased and trimmed, while the server's policy needs exactly `prod`. With a misspelled `FOCUSTIME_ENV` such as `Prod`, the label says prod and the switch is hidden while the server treats it as a test site: nothing is sent, the safe side. Fix the label too, or leave it?
- The DevOps store on a test site runs only while someone is active there, so the first screen after a quiet night reads from a store up to a night old until the next poll (seconds). Acceptable?
- Not run here: a live Bicep what-if against Azure (the step's rules allow nothing against Azure). The compiled parameters were compared offline (`az bicep build-params`); deploy-dev prints the real what-if on merge.

