import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { PaneCompositePartService } from "../paneCompositePartService.ts";

export const AuxiliaryBarServiceDIToken = token<AuxiliaryBarService>("AuxiliaryBarService");

/**
 * Таб-строка **вторичной боковой панели** (Secondary Side Bar, VS Code
 * `ViewContainerLocation.AuxiliaryBar`) + её видимость: вкладки — контейнеры с
 * `location: "auxiliarybar"`. У эталона `AuxiliaryBarPart` при
 * `workbench.activityBar.location=default` показывает контейнеры вкладками в
 * заголовке, как панель, поэтому механика общая —
 * {@link PaneCompositePartService}.
 */
export class AuxiliaryBarService extends PaneCompositePartService {}
