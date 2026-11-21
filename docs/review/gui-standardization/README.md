# GUI standardization visual review

Synthetic project fixtures from the Linux Electron/Playwright harness; no real
workspace content or credentials. Before is current main at `053126a`. After
shows this branch's white reading surfaces, unified sidebar, navigation combobox,
main-card panel toggles, Files dropdown and file-only Close action below its header.

| Before | After |
| --- | --- |
| ![Before: separate navigation cards and file tabs](before-light.png) | ![After: unified navigation and Files dropdown](after-light.png) |

Appearance also adds optional locally saved Monochrome icons, a color picker
(gray by default), and a 0–200% contrast slider. Colored artwork remains the
default; system colors bypass the tint. Back/Forward artwork plays once on click.

![Monochrome icons with a selected color and 200% contrast](after-monochrome.png)
