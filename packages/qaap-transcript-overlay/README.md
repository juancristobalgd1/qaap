# @theia/qaap-transcript-overlay

Transcript overlay kernel for Qaap mobile Work Hub:

- `WorkHubTranscriptBridge` — explicit hub surface for transcript modules
- `TranscriptOverlayState` — mutable overlay state bag
- `qaap-transcript-*` rendering utilities (virtual list, scroll pin, live controller, …)

The transcript renderers (`MobileProjectsTranscript*Ui`) live in `@theia/qaap-transcript`
and the overlay controller / execution surfaces in `@theia/qaap-work-hub`; both build on
this kernel. Delivery-mode strip (markup + CSS) and queued-bubble cleanup live here.
