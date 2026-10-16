# Upstream Sync

How to update something this repo takes from another project. Vocabulary (Upstream, Pinned Revision, Vendored Content, Adaptation, Excluded) is defined in `GLOSSARY.md`.

Pick the branch:

- **Vendored Content**: Caveman, Ponytail. Upstream files are copied into a package.
- **External runtime**: Headroom server, RTK binary. Nothing is copied; a running program is upgraded.

## Vendored Content

| Package | Upstream | Pinned Revision and file list |
| --- | --- | --- |
| `packages/caveman` | `https://github.com/JuliusBrussee/caveman` | `packages/caveman/THIRD-PARTY-NOTICES.txt` |
| `packages/ponytail` | `https://github.com/DietrichGebert/ponytail` | `packages/ponytail/THIRD-PARTY-NOTICES.txt` |
| `packages/pstack` | `https://github.com/cursor/plugins` (`pstack/`) | `packages/pstack/THIRD-PARTY-NOTICES.txt` |

The notices file is the single source of truth for the Pinned Revision and the vendored file list. The package README lists Adaptations and Excluded parts.

1. Read the Pinned Revision and file list from the notices file.
2. Clone Upstream into `/tmp`, check out the target (latest `main` unless the user names a tag), and record its full SHA.
3. Diff old against new for every vendored file, Upstream's license files (`LICENSE*`, `NOTICE`, `LICENSING.md`), and the Upstream code our package mirrors (Caveman: mode aliases and deactivation phrases; Ponytail: `hooks/ponytail-instructions.js`, `hooks/ponytail-config.js`, `pi-extension/index.js`).
4. Classify the diff. **Wording only**: continue. **Structural**: stop and report to the user before changing anything. Structural means a Mode Level added, removed or renamed; a vendored file moved, split or merged; a changed command, alias or deactivation phrase; a changed license.
5. Copy the vendored files byte-for-byte, then reapply the Adaptations listed in the README.
6. Update mirrored code to match step 3, then update the notices file (SHA, file list, license text) and the README Pinned Revision.
7. Run `bun run verify`, then start `omp` with the feature and switch through every Mode Level and `off`.

Done when every vendored file matches the new Pinned Revision, the notices file and README name it, verify passes, and the user has a short list of behavior changes.

## External runtime

### Headroom server

The repo `compose.yaml` is the source of truth for the homelab deployment (`ssh local-ubuntu-server`, directory `~/headroom`, secrets in `.env`, which is never committed).

1. Read the Upstream `CHANGELOG.md` between the running version and the target. Look for breaking items: renamed or removed env vars, bind or auth policy, license, image variants.
2. Confirm the image exists: `docker manifest inspect ghcr.io/headroomlabs-ai/headroom:<version>-code-nonroot`.
3. Confirm every safety env var in `compose.yaml` still exists in the new image: grep each name under the image's `site-packages/headroom`. The reasons are in `docs/research/headroom-0.40-agent-pitfalls.md`.
4. Back up state on the homelab with `docker run --rm -v ~/.headroom:/d:ro -v ~:/out alpine tar czf /out/headroom-backup-<date>.tgz -C /d .`, and copy `compose.yaml` aside.
5. Edit the repo `compose.yaml`, copy it to the homelab, and run `docker compose up -d` while no OMP session is mid-task, because a restart drops Headroom's session caches.
6. Verify:
   - `/health` reports the new version.
   - Logs show `Code-Aware: ENABLED`.
   - `docker exec headroom env` lists the safety vars.
   - `POST /v1/compress` with `config.session_id` returns a `session` block.
   - A `read` tool result comes back with `router:excluded:tool`.

### RTK binary

1. `HOMEBREW_NO_AUTO_UPDATE=1 brew upgrade rtk`, and read the Upstream changelog for rewrite rules, filters that can hide failures, and tracking changes.
2. Check that the contract `packages/rtk` relies on still holds:
   - `rtk rewrite` exit codes (0 or 3 rewrite, 1 or 2 leave unchanged), checked on `git status`, `cargo test`, `go test ./...` and `bun test`.
   - `RTK_DB_PATH` and `RTK_RECALL_DB` are honored.
   - The `commands` table columns are the ones read in `packages/rtk/src/store.ts`.
3. Adjust the guard list in `packages/rtk/src/rewrite.ts` and the minimum version if needed, then run `bun run verify`.
4. Smoke: start `omp`, run one rewritten command, and watch the RTK segment change.
