# ma9icAI Performance Baseline — Before Responsiveness Update

Date: 2026-10-02

This checkpoint records the known-good state immediately before the planned responsiveness/performance pass.

## Current checkpoint
- Latest Roblox saved-password fix: `6e6e66d51dfeb74b2fb124a8536e40920b05bee1`
- Commit: `Physically click browser web fields to open credential UI`
- Previous 2.5D black-flash fix: `985d853c615bfd601e0e3b62051833540d789e46`
- Whisper/microphone behavior is known-good and is not to be changed in the first performance pass.

## Roblox baseline
The sign-in flow switches to 2D/2.5D, detects the browser, opens Roblox login, selects the saved username, physically clicks the password field to open Chromium/Brave credential UI, selects the saved account without reading/logging/typing the password, clicks Log In, and restores normal mode.

Password secrets must never be read, logged, exposed, or typed.

## Automation baseline
Primary automation code: `electron/main.cjs`, exposed through `electron/preload.cjs`.

Important actions include:
- MOVE_MOUSE
- CLICK
- DOUBLE_CLICK
- TYPE_TEXT
- KEY_PRESS
- CLICK_UI_ELEMENT
- FIND_UI_ELEMENT
- INSPECT_UI_TREE
- WAIT_FOR_UI_ELEMENT
- CLICK_WEB_FIELD
- DETECT_WEBPAGE

Current CLICK_WEB_FIELD uses UI Automation to locate the browser Edit control, SetFocus(), then a real Windows mouse click at the field center and returns its bounds/click coordinates.

## 2.5D baseline
`src/App.tsx` uses `experienceMode` as the source of truth for full/model display mode. The login path no longer directly calls the separate overlay-layout path, avoiding duplicate BrowserWindow resize/repaint cycles and the previous black flash.

## Voice baseline
Whisper is prewarmed and kept resident. Do not modify the known-good Whisper transcript/stop behavior during the initial performance pass.

Relevant restoration history:
- c1210e2 Restore known-good Whisper transcript handling
- 3fcb413 Restore known-good mic stop behavior
- ea23847 Restore known-good Whisper transcript handling
- ba96fcb Restore known-good Whisper capture path
- 00fceef Allow mic stop to flush final Whisper transcript
- 3ddb6bb Preserve final transcript when mic button stops listening
- 7d25287 Keep final Whisper transcript when mic is manually stopped
- 54c7be4 Prevent duplicate Whisper transcripts after phrase flush

## Performance plan
1. Replace unnecessary fixed sleeps with condition-based waits.
2. Parallelize independent detection/inspection where safe.
3. Cache stable browser HWND/PID information.
4. Target UI Automation searches and short-circuit when the requested element is found.
5. Improve/reuse wait primitives.
6. Reduce unnecessary post-action delays.
7. Add lightweight action timing telemetry.
8. Optimize the fast path for common desktop commands.
9. Preserve Roblox credential selection.
10. Preserve Whisper/mic behavior.

## Rules
- Do not expose or type saved passwords.
- Do not modify Whisper/mic behavior in the first performance pass.
- Do not remove required Windows/browser synchronization waits without replacing them with condition-based waits.
- Every performance change should be independently testable and committed.

## Build note
`npm run desktop:dev` runs the build before Electron. Build scripts rewrite parts of the source, so generated output must be checked after performance changes.

This note is the rollback/reference point for the performance work.
