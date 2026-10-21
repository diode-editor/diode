import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IPaneCompositeView, IPaneCompositeViewDescriptor } from "../paneCompositePartService.ts";
import { PaneCompositePartService } from "../paneCompositePartService.ts";

export const PanelServiceDIToken = token<PanelService>("PanelService");

export type IPanelViewDescriptor = IPaneCompositeViewDescriptor;

export type IPanelView = IPaneCompositeView;

/** A separate class for its own DI token, like upstream `PanelPart` next to `AuxiliaryBarPart`. */
export class PanelService extends PaneCompositePartService {}
