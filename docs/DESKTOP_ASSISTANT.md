# Desktop assistant

The Electron helper displays Coucou's original Mochi using its Canvas drawing
engine in a transparent 120 DIP window. Dragging, keyboard movement, saved
position, tray recovery and the native quick-action menu remain available.
The eyes follow the desktop cursor; the helper greets on launch, blinks and
reacts to pressing and hovering. This version has no audio or business-status
animations. Reduced motion displays a neutral still pose. Hiding the helper
stops cursor polling and rendering; closing the main window disposes it.

Only normalized gaze reaches the isolated renderer. It receives neither screen
coordinates nor access to the authenticated main window's session.

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
