# Project sidebar titles

Issue [#264](https://github.com/CodeManufactoryLLC/Code60/issues/264) removes the
secondary status text beneath project names. Project titles remain vertically
centered in the shared navigation row, with the existing session, close and
disclosure controls.

The Linux-container desktop fixture opens three synthetic projects. The baseline
regression fails on `project-aActive`; the corrected version expects only the
project name, checks its accessible name and alignment, and selects A → B → C → A
with the keyboard. The existing scenario also exercises retained drafts, project
controls, Light/Dark, narrow sidebars and enlarged navigation text.

- [Before](before.png): the active project displays an “Active” subtitle.
- [After](after.png): project names have no secondary status line.

These images contain only synthetic fixture content. Project lifecycle and
underlying activity state are unchanged. This presentation change adds no
capability, prerequisite, confirmation, limit or setting, so no self-knowledge
catalog or generated capabilities update is needed.
