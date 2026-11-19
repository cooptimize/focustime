## Chat images without storage (CV-4, Nov 5)

- Q-CV4-1: Drop `teams_message_images.bytes` (and the unused `failed` attempts) in a release after CV-4 has been in prod, with a `safe-drop` comment (D468); `store/images-bytes.test.ts` guards it until then.
- Q-CV4-2: An image read for the AI or a create is a second Graph read when someone also views it. Fine at today's volume; revisit if Graph throttles hostedContents.
- Q-CV4-3: gpt-6-luna's image token multiplier isn't in OpenAI's images-vision table as read on Nov 5 (gpt-6-astra and gpt-5.6-luna are 1.2); the cost figures assume 1.2. Check the request log's input tokens after the first week with the switch on.

