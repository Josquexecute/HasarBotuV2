# Desktop assistant

The Electron helper displays Coucou's original Mochi using its Canvas drawing
engine in a transparent 120 DIP window. Dragging, keyboard movement, saved
position, tray recovery and the native quick-action menu remain available.
The eyes follow the desktop cursor; the helper greets on launch, blinks and
reacts to pressing and hovering. This version has no audio or business-status
animations. Reduced motion displays a neutral still pose. Hiding the helper
stops cursor polling and rendering; closing the main window disposes it.

Only normalized gaze reaches the isolated character renderer. It receives neither
screen coordinates nor access to the authenticated main window's session.

## Standalone case panel (desktop 0.1.6)

Click the character or choose **Hızlı not / Dosyalar** from the tray to open the
420 × 720 DIP panel, constrained to the display work area. The main window stays
hidden while the panel searches plates or office numbers across open and closed
cases, selects a case and saves notes through the existing authenticated API.

**Geçmiş notlar** searches current and imported historical notes. **Süreçler**
shows the current stage, owner, follow-up, tasks, follow-up history and Tramer /
document review status. Selection persists per user. Existing quick-note drafts
remain separate per user and case; viewing another tab does not discard them.

The panel shares the main window's HttpOnly session, but exposes only fixed menu
actions through its preload. Node integration, external navigation, new windows
and downloads remain disabled. API permissions govern every read and write.
If login is needed, **Giriş yap** opens the main window explicitly; focusing the
panel afterwards refreshes its session. Focusing the main app reloads notes saved
by the panel. Escape closes the panel.

Regression coverage includes isolated PostgreSQL note persistence, starting the
panel before login, hidden-main-window search and save, history, process status,
selection after shell recreation, light/dark themes, viewport bounds at 150%
zoom, read-only permissions, authorization failure and stale search responses.

## Upstream source

`public/vendor/coucou/` is generated from Louis-CFM/coucou revision
`1dc314f632ff646b44191dbd4e89b042e07b3670`. It retains the original drawing and
animation code, with audio calls removed because no audio player is integrated.
Regenerate with Node 24 and `node scripts/vendor-coucou-mochi.mjs` (requires
network access). Normal builds use the checked-in files and work offline.

Source: https://github.com/Louis-CFM/coucou

The upstream MIT code license and separate character/artwork license are
included in `public/vendor/coucou/`. Mochi's character is not covered by MIT;
upstream requires written permission for distributing an app containing it.
Local implementation and build validation do not establish distribution rights.
