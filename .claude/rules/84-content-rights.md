# Content rights (always on)

- Competitor media never appears in output. Competitor items are references: their analysed hooks, structure, pacing and scenarios can be reused, their pixels and audio cannot. An asset with `library = 'competitor'` can never be referenced by a content item's media; the database and the render worker both enforce it.
- A generated variant too similar to a referenced competitor frame is rejected and re-planned.
- Stock or third-party clips can be used only when the asset's `rights_status` records a licence or permission. Being short does not make a clip legal to reuse.
- Music comes only from `music_tracks` with a royalty-free licence on record; it is mixed into the file because Instagram's music library is not available to API publishing.
- Nothing is published without the user's approval, and each item publishes once.
- Downloaded competitor items keep source URL, author, platform, download date and a metrics snapshot. Search results that are not downloaded expire after 7 days; discarded drafts after 7 days.
- Vendored third-party code (the Instagram skills, MIT) keeps its licence file and a line in `THIRD_PARTY_NOTICES.md`.
