import type { TypeHierarchyProvider } from "../../../../editor/common/languages/iTypeHierarchySource.ts";
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
import { TYPE_HIERARCHY_MODE_STATE, type TypeHierarchyMode } from "../../../common/stateKeys.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import type { IJumpRecorder } from "../../../services/history/browser/historyService.ts";
import { JumpRecorderDIToken } from "../../../services/history/browser/historyService.ts";
import type { NotificationService } from "../../../services/notification/browser/notificationService.ts";
import { NotificationServiceDIToken } from "../../../services/notification/browser/notificationService.ts";

import type { CallHierarchyComponent } from "./callHierarchyComponent.ts";
import { CallHierarchyComponentDIToken } from "./callHierarchyComponent.ts";
import { HierarchyComponent, type IHierarchyKind } from "./hierarchyComponent.ts";
import type { IReferencesRevealTarget, ReferencesComponent } from "./referencesComponent.ts";
import { ReferencesComponentDIToken, ReferencesRevealTargetDIToken } from "./referencesComponent.ts";
import { TypesModel } from "./typeHierarchyModel.ts";

export const TypeHierarchyComponentDIToken = token<TypeHierarchyComponent>("TypeHierarchyComponent");

const TYPES: IHierarchyKind<TypeHierarchyMode, TypeHierarchyProvider> = {
    idPrefix: "typeHierarchy",
    modeState: TYPE_HIERARCHY_MODE_STATE,
    modeKey: "typeHierarchyMode",
    visibleKey: "typeHierarchyVisible",
    providers: (languageFeatures) => languageFeatures.typeHierarchyProvider,
    prepare: (provider, request, cancellation) => provider.prepareTypeHierarchy(request, cancellation),
    release: (provider, sessionId) => {
        provider.releaseTypeHierarchy(sessionId);
    },
    createModel: (provider, sessionId, direction, roots, cancellation) =>
        new TypesModel(provider, sessionId, direction, roots, cancellation),
    title: (direction) => (direction === "supertypes" ? "Supertypes Of" : "Subtypes Of"),
    // Upstream `TypeItemDataProvider.getTreeItem`: the same place in both directions.
    target: (_direction, node) => node.item.selectionRange.start,
};

/** Upstream's `references-view` extension, `types/`. Takes turns with the call tree in the one hierarchy section. */
export class TypeHierarchyComponent extends HierarchyComponent<TypeHierarchyMode, TypeHierarchyProvider> {
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
        CallHierarchyComponentDIToken,
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
        calls: CallHierarchyComponent,
    ) {
        super(
            TYPES,
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
        // The dependency is one-way: a call tree that has never met a type tree has nothing to dismiss.
        this.register(
            this.onWillShow(() => {
                calls.dismiss();
            }),
        );
        this.register(
            calls.onWillShow(() => {
                this.dismiss();
            }),
        );
    }
}
