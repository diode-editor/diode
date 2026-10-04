import { BodyElement } from "@tuidom/elements/body/bodyElement";

import { ContextKeyService } from "../vs/platform/contextkey/common/contextKeyService.ts";
import { NULL_STATE_SERVICE } from "../vs/platform/state/common/nullStateService.ts";
import { PanelService } from "../vs/workbench/browser/parts/panel/panelService.ts";
import { LayoutService } from "../vs/workbench/services/layout/browser/layoutService.ts";

/**
 * Настоящий `LayoutService` с прикреплённой корневой view — хостом
 * `mainContainer`, на слое которого оверлеи создают сессии. Без аргумента
 * корень создаётся здесь же.
 */
export function testLayoutService(root: BodyElement = new BodyElement()): LayoutService {
    const service = detachedLayoutService();
    service.attachRoot(root);
    return service;
}

/** Тот же сервис до `attachRoot`: обращение к `mainContainer` бросает. */
export function detachedLayoutService(): LayoutService {
    return new LayoutService(NULL_STATE_SERVICE, new PanelService(), new ContextKeyService());
}
