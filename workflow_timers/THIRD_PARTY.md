# Third-party source and license

The `custom_components/scheduler` directory is derived from
[nielsfaber/scheduler-component](https://github.com/nielsfaber/scheduler-component),
commit `71cab7b7b76502b7f30b202463e3d89b7eff7ad6` (2026-03-01),
licensed under GNU GPL v3. The complete upstream license is included in `LICENSE`.
Original authorship remains with the upstream contributors. This package is a
modified distribution, not an official Scheduler release.

Local changes add the WorkFlow sidebar panel, a persistent skip-today command,
execution guards for skipped activations, stable entity IDs on rename, and a
correction to the action queue's initial skip flag. The original storage format
and integration domain `scheduler` are retained for compatibility.

The WorkFlow frontend, installer, examples and tests are also provided under
GPL-3.0. The upstream scheduler-card was researched but its frontend code is not
included. HACS updates of the official scheduler-component replace this fork;
use the WorkFlow installer to update this installation.
