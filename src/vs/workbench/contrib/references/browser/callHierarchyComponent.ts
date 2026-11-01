import type { CallHierarchyProvider } from "../../../../editor/common/languages/iCallHierarchySource.ts";
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IStateService } from "../../../../platform/state/common/iStateService.ts";
import { StateServiceDIToken } from "../../../../platform/state/common/iStateService.ts";
import type { IProductIconService } from "../../../../platform/theme/common/productIconService.ts";
import { ProductIconServiceDIToken } from "../../../../platform/theme/common/productIconService.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { CALL_HIERARCHY_MODE_STATE, type CallHierarchyMode } from "../../../common/stateKeys.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import type { IJumpRecorder } from "../../../services/history/browser/historyService.ts";
import { JumpRecorderDIToken } from "../../../services/history/browser/historyService.ts";
import type { NotificationService } from "../../../services/notification/browser/notificationService.ts";
import { NotificationServiceDIToken } from "../../../services/notification/browser/notificationService.ts";

import { callNodeTarget, CallsModel } from "./callHierarchyModel.ts";
import { HierarchyComponent, type IHierarchyKind } from "./hierarchyComponent.ts";
import type { IReferencesRevealTarget, ReferencesComponent } from "./referencesComponent.ts";
import { ReferencesComponentDIToken, ReferencesRevealTargetDIToken } from "./referencesComponent.ts";

export const CallHierarchyComponentDIToken = token<CallHierarchyComponent>("CallHierarchyComponent");

const CALLS: IHierarchyKind<CallHierarchyMode, CallHierarchyProvider> = {
    idPrefix: "callHierarchy",
    modeState: CALL_HIERARCHY_MODE_STATE,
    modeKey: "callHierarchyMode",
    visibleKey: "callHierarchyVisible",
    providers: (languageFeatures) => languageFeatures.callHierarchyProvider,
    prepare: (provider, request, cancellation) => provider.prepareCallHierarchy(request, cancellation),
    release: (provider, sessionId) => {
        provider.releaseCallHierarchy(sessionId);
    },
    createModel: (provider, sessionId, direction, roots, cancellation) =>
        new CallsModel(provider, sessionId, direction, roots, cancellation),
    title: (direction) => (direction === "incoming" ? "Callers Of" : "Calls From"),
    target: callNodeTarget,
};

/** Upstream's `references-view` extension, `calls/`. */
export class CallHierarchyComponent extends HierarchyComponent<CallHierarchyMode, CallHierarchyProvider> {
    public static dependencies = [
        ViewsServiceDIToken,
        ReferencesComponentDIToken,
        EditorServiceDIToken,
        LanguageFeaturesServiceDIToken,
        ReferencesRevealTargetDIToken,
        JumpRecorderDIToken,
        StateServiceDIToken,
        ContextKeyServiceDIToken,
        NotificationServiceDIToken,
        ProductIconServiceDIToken,
        IConfigurationServiceDIToken,
    ] as const;

    public constructor(
        viewsService: ViewsService,
        references: ReferencesComponent,
        group: IEditorService,
        languageFeatures: ILanguageFeaturesService,
        revealTarget: IReferencesRevealTarget,
        jumps: IJumpRecorder,
        state: IStateService,
        contextKeys: ContextKeyService,
        notifications: NotificationService,
        icons: IProductIconService,
        configuration: IConfigurationService,
    ) {
        super(
            CALLS,
            viewsService,
            references,
            group,
            languageFeatures,
            revealTarget,
            jumps,
            state,
            contextKeys,
            notifications,
            icons,
            configuration,
        );
    }
}
