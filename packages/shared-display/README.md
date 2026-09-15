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
