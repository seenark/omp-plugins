# Coding standards

Rules a reviewer applies to a diff because no lint can. One heading per rule, with the reason. Add a rule only when a review caught the same mistake twice and no check can catch it.

## Canonicalize paths before comparing or keying on them

A path that comes from git, omp, the user, or session history is compared or used as a key only after `canonicalPath` from `@codesook/omp-shared-display/project-integrations`.

The same folder has several spellings. `git rev-parse --show-toplevel` returns the real path, while the working directory, a session's recorded `cwd`, and a path typed by the user keep whatever spelling they were given. On macOS `/tmp` and `/var` are symlinks to `/private/...`, so `/var/folders/x` and `/private/var/folders/x` are one folder that raw string comparison treats as two. Skill Stats once showed an empty project dashboard for exactly this reason.

Use `resolveIntegrationProject` for the Integration Project of a working directory. It already returns a canonical path. Call `canonicalPath` directly for any other path that is compared or stored, such as a skill's project root or the home directory. Do not write a private `realpathSync` helper.

Tests that build an expected path from a temporary directory compare against `realpathSync` of that directory.
