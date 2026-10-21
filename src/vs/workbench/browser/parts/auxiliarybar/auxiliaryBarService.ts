import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { PaneCompositePartService } from "../paneCompositePartService.ts";

export const AuxiliaryBarServiceDIToken = token<AuxiliaryBarService>("AuxiliaryBarService");

/**
 * Механика общая с панелью: у эталона `AuxiliaryBarPart` при
 * `workbench.activityBar.location=default` показывает контейнеры вкладками в заголовке.
 */
export class AuxiliaryBarService extends PaneCompositePartService {}
