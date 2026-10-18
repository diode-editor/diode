import { BodyElement } from "@tuidom/elements/body/bodyElement";

import { NULL_CONFIGURATION_SERVICE } from "../vs/platform/configuration/common/nullConfigurationService.ts";
import { ContextKeyService } from "../vs/platform/contextkey/common/contextKeyService.ts";
import { NULL_STATE_SERVICE } from "../vs/platform/state/common/nullStateService.ts";
import { WorkspaceContextService } from "../vs/platform/workspace/common/workspaceContextService.ts";
import { AuxiliaryBarService } from "../vs/workbench/browser/parts/auxiliarybar/auxiliaryBarService.ts";
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
    return new LayoutService(
        NULL_STATE_SERVICE,
        new PanelService(),
        new ContextKeyService(),
        new AuxiliaryBarService(),
        NULL_CONFIGURATION_SERVICE,
        new WorkspaceContextService(),
    );
}
