import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { PaneCompositeFocusContribution } from "../paneCompositeFocusContribution.ts";

import type { PanelComponent } from "./panelComponent.ts";
import { PanelComponentDIToken } from "./panelComponent.ts";
import type { PanelService } from "./panelService.ts";
import { PanelServiceDIToken } from "./panelService.ts";

export const PanelFocusContributionDIToken = token<PanelFocusContribution>("PanelFocusContribution");

export class PanelFocusContribution extends PaneCompositeFocusContribution {
    public static dependencies = [PanelServiceDIToken, PanelComponentDIToken, EditorServiceDIToken] as const;

    public constructor(panelService: PanelService, panelComponent: PanelComponent, editorService: IEditorService) {
        super(panelService, panelComponent, editorService);
    }
}
