# Next.js security update: deployment gate

The GPW calendar changes and Next.js dependency update are prepared together,
but neither is deployed by this branch. The application now pins Next.js and
`eslint-config-next` to 16.4.2 and React, React DOM and
`react-server-dom-webpack` to 19.2.9. The workspace-root `package-lock.json`
is authoritative; the obsolete nested lockfile has been removed.

## Why the existing deploy cannot be run unchanged

`.github/workflows/deploy-production.yml` intentionally refuses any change to
the root dependency manifests or application manifest before checking out the
new revision. It then reuses the existing `/opt/mexo/repo/node_modules` while
building a new `.next` release. This protects the running process from an
in-place `npm install`, but also means that simply merging this update and
triggering the workflow would fail preflight. **Do not bypass the manifest
check or run `npm ci` in the live repository while Mexo is serving traffic.**

## Approved future release procedure (not executed here)

1. After separate authorization, preserve the current production source SHA,
   `.next` artifact and complete dependency tree as a rollback unit. Take the
   usual database backup before calendar reprojection; no data migration is
   required by the Next.js upgrade itself.
2. Add a reviewed, dependency-aware deployment path that installs the locked
   dependencies in a separate staging directory on the same Oracle ARM64
   platform, using Node 24 and the workspace-root lockfile. Keep the existing
   manifest guard for the normal no-dependency-change path.
3. Build and smoke-test the staged release (including login/session, public
   calendar, APIs and ICS) without changing the live service or production
   calendar data. Check that the ARM64 SWC binary and Sharp load successfully.
4. Atomically activate source, matching dependency tree and build artifact as
   one release; restart Mexo once. Verify `/api/system/revision`, login, API,
   calendar and error logs before starting any GPW data repair.
5. If activation fails, atomically restore the **entire** previous source,
   dependency tree and build artifact, restart once and verify the old SHA.
   Rolling back only `.next` while leaving Next.js 16.4.2 dependencies in
   place is not a valid rollback.
6. Only after that release is stable, follow
   `GPW-CALENDAR-READONLY-AUDIT-2026-10-23.md` for an approved rehearsal,
   supervised reprojection/backfill and eventual timer enablement.

No workflow, Oracle service, GitHub deployment, timer or production database
was changed in preparing this note.
