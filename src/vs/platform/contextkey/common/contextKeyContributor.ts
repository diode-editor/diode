import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import type { Token } from "../../instantiation/common/diContainer.ts";
import { token } from "../../instantiation/common/diContainer.ts";

import type { ContextKeyService } from "./contextKeyService.ts";

/**
 * The hub (`WorkbenchContextKeys`) polls contributors before resolving each
 * binding and on focus change (pull): a key self-heals on the next keypress and does not
 * get stuck. A key with a single state transition may be pushed by its feature directly;
 * contributors are for what is derived from focus or changes without an event.
 */
export interface IContextKeyContributor {
    updateContextKeys(contextKeys: ContextKeyService, active: TUIElement | null): void;
}

/** The hub resolves these when it is created: only features that start with the workbench anyway belong here. */
export const ContextKeyContributorsDIToken = token<readonly Token<IContextKeyContributor>[]>("ContextKeyContributors");
