import type { Group } from "../types.ts";
import { collisions } from "./collisions.ts";
import { core } from "./core.ts";
import { dispatch } from "./dispatch.ts";
import { panel } from "./panel.ts";
import { pr } from "./pr.ts";
import { sessions } from "./sessions.ts";

/**
 * Table order is rule order: collision renames first, then each group in this order. Add rules to the
 * group file that owns the Cursor primitive; this list changes only when a group is added.
 */
export const groups: readonly Group[] = [collisions, core, dispatch, panel, pr, sessions];
