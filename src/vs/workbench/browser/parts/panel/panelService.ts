import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IPaneCompositeView, IPaneCompositeViewDescriptor } from "../paneCompositePartService.ts";
import { PaneCompositePartService } from "../paneCompositePartService.ts";

export const PanelServiceDIToken = token<PanelService>("PanelService");

export type IPanelViewDescriptor = IPaneCompositeViewDescriptor;

export type IPanelView = IPaneCompositeView;

/** Свой класс ради своего DI-токена, как у эталона `PanelPart` рядом с `AuxiliaryBarPart`. */
export class PanelService extends PaneCompositePartService {}
