import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import { Disposable } from "../../base/common/lifecycle.ts";

/**
 * A component owns its root control ({@link view}) but does not extend
 * TUIElement. There are no separate mount()/activate(): everything happens in the constructor,
 * async initialization lives in services (`IActivatable`). Colors are set by token NAMES
 * once at creation (N3): a theme hot-swap propagates through the cascade.
 */
export abstract class Component extends Disposable {
    public abstract readonly view: TUIElement;
}
