import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { PaneCompositePartService } from "../paneCompositePartService.ts";

export const AuxiliaryBarServiceDIToken = token<AuxiliaryBarService>("AuxiliaryBarService");

/**
 * Shares its mechanics with the panel: with `workbench.activityBar.location=default`,
 * upstream `AuxiliaryBarPart` shows containers as tabs in its title.
 */
export class AuxiliaryBarService extends PaneCompositePartService {}
