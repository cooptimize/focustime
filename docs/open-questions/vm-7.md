## VM-7: a refused Azure answer's three facts (Nov 18)

- **Admin › Health's line for Azure answers.** Left out: Health keeps nothing it could count them from. If admins want it, a small in-memory count of today's answers by the three words (per copy of the app, lost on a restart) is the least that would do; it isn't built here.
- **A Bearer challenge with no error word.** Logged as `challenge=none`, the same as no header at all: the list has no word for "a challenge without an error", and adding one would widen it. Taken as the reading that changes less. A scheme other than Bearer is "other".
- **What the words will show.** Nothing here was seen on production: the next stretch of refusals is the test. `cause` is set by Azure Resource Manager on some refusals only; when it's absent it reads none, which says the header wasn't there, not that nothing failed.
- **Two edges from the review (nothing leaks, nothing changes).** VM-6's `challengeNamesToken` has no word boundary after the error word, so `error="invalid_tokenX"` is still read as a sign-in while VM-7 logs it `other`; and both read an `error=` written inside another parameter's value. Tightening VM-6's reading would change what a refusal does, so it's left for its own step.

