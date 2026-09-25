# @codesook/omp-shared-display

Opt-in OMP extension that owns `codesook-shared-display` widget and versioned EventBus snapshot protocol for Ponytail, Caveman, and Headroom producers.

Side-effect-free client and root config helpers:

```ts
import { connectSharedDisplay } from "@codesook/omp-shared-display/client";
import { readCodesookOmpConfig } from "@codesook/omp-shared-display/config-store";
```

Shared Display presentation persists in `display.sharedDisplay` inside:

```text
~/.config/codesook-omp/config.json
```

Legacy `~/.config/codesook-omp/shared-display/config.json` migrates once when root section is missing. `/shared-display` command is removed; root `/codesook-omp-plugin` settings owns persisted presentation. Producers remain safe when host/EventBus is absent.

## Frame assets

All plugin glyph files use shared `FrameSequence` text format. Optional first nonblank `fps=<positive number>` sets animation rate; blank-line-separated blocks form frames, and rows within each block stay together. One frame or missing/invalid FPS displays first frame statically. Context Rail also accepts `size=<width>x<height>` as layout metadata before frame rows.
