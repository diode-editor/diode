import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { PaneCompositeFocusContribution } from "../paneCompositeFocusContribution.ts";

import type { AuxiliaryBarComponent } from "./auxiliaryBarComponent.ts";
import { AuxiliaryBarComponentDIToken } from "./auxiliaryBarComponent.ts";
import type { AuxiliaryBarService } from "./auxiliaryBarService.ts";
import { AuxiliaryBarServiceDIToken } from "./auxiliaryBarService.ts";

export const AuxiliaryBarFocusContributionDIToken = token<AuxiliaryBarFocusContribution>(
    "AuxiliaryBarFocusContribution",
);

/** Upstream `setAuxiliaryBarHidden` calls `focusPanelOrEditor` when hiding. */
export class AuxiliaryBarFocusContribution extends PaneCompositeFocusContribution {
    public static dependencies = [
        AuxiliaryBarServiceDIToken,
        AuxiliaryBarComponentDIToken,
        EditorServiceDIToken,
    ] as const;

    public constructor(
        auxiliaryBarService: AuxiliaryBarService,
        auxiliaryBarComponent: AuxiliaryBarComponent,
        editorService: IEditorService,
    ) {
        super(auxiliaryBarService, auxiliaryBarComponent, editorService);
    }
}
