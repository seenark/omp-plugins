# @codesook/omp-shared-display

Opt-in OMP extension that owns the `codesook-shared-display` widget and a versioned EventBus snapshot protocol for Ponytail, Caveman, and Headroom producers.

The side-effect-free client is available from `@codesook/omp-shared-display/client`:

```ts
import { connectSharedDisplay, parseFrameSequenceAsset } from "@codesook/omp-shared-display/client";
```

Configure the host at `~/.config/codesook-omp/shared-display/config.json`. The extension registers `/shared-display status` and `/shared-display config`; producers remain safe when no host or EventBus is available.
