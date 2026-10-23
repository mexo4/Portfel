# Next.js security update: isolated release and remaining gates

The GPW calendar changes and Next.js dependency update are prepared together,
but neither is deployed by this branch. The application now pins Next.js and
`eslint-config-next` to 16.4.2 and React, React DOM and
`react-server-dom-webpack` to 19.2.9. The workspace-root `package-lock.json`
is authoritative; the obsolete nested lockfile has been removed. This branch
is still not deployed.

## Why the existing deploy cannot be run unchanged

The previous workflow reused `/opt/mexo/repo/node_modules` and rejected all
dependency changes. Installing new packages in that live tree would risk
breaking the currently running server and make rollback incomplete.

## Isolated release path

The reviewed workflow now archives the candidate commit into a unique release
directory, links the protected environment file without copying it, runs
`npm ci` and the production build inside that isolated release on the Oracle
ARM64 host, then switches `.next` and the runtime working directory only after
the build passes. The running release keeps its own Node dependencies. Previous
source/build directories remain available for rollback, and the new launcher
continues to support both the existing legacy release layout and the isolated
layout. The workflow still refuses non-dependency manifest/lifecycle changes
and root workspace configuration changes.

The workflow has not yet been exercised by a production deployment. Its
preflight must pass and the remote build must confirm the ARM64 native binaries
load correctly before the release is considered verified. Do not run `npm ci`
in `/opt/mexo/repo` while Mexo is live.

No calendar data repair or timer enablement is part of the app release. The
production source backfill is incomplete and three dividend documents still
fail parsing in the disposable rehearsal; keep the timer disabled until those
items and the read-only month audits have been reviewed. A full database backup
is required before any future production reprojection, not merely before this
non-destructive application release.

This note does not claim that a workflow run, deployment, production data
repair, or timer activation has occurred.
