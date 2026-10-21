import type { OverlayHostElement } from "@tuidom/elements/contextview/overlayHostElement";
import type { EditorPartOrientation } from "@tuidom/elements/editorpart/editorPartElement";
import { EditorPartElement } from "@tuidom/elements/editorpart/editorPartElement";

import type { MenuService } from "../../../../platform/actions/common/menuService.ts";
import { MenuServiceDIToken } from "../../../../platform/actions/common/menuService.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { ContextMenuServiceDIToken } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { GroupId } from "../../../services/editor/browser/editorGroupModel.ts";
import type { IEditorGroupsService } from "../../../services/editor/common/editorGroupsService.ts";
import {
    EditorGroupsServiceDIToken,
    type IGroupsChangeEvent,
} from "../../../services/editor/common/editorGroupsService.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { Component } from "../../component.ts";

import { EditorGroupComponent } from "./editorGroupComponent.ts";

export const EditorPartComponentDIToken = token<EditorPartComponent>("EditorPartComponent");

export class EditorPartComponent extends Component {
    public static dependencies = [
        EditorServiceDIToken,
        ContextMenuServiceDIToken,
        EditorGroupsServiceDIToken,
        MenuServiceDIToken,
        ContextKeyServiceDIToken,
        IConfigurationServiceDIToken,
    ] as const;

    public readonly view: EditorPartElement;
    private readonly groupComponents = new Map<GroupId, EditorGroupComponent>();

    /** Только по действию пользователя, не при программном ресторе. */
    public onDidChangeGroupLayout?: () => void;

    public constructor(
        private readonly editorService: IEditorService,
        private readonly contextMenuService: ContextMenuService,
        private readonly groups: IEditorGroupsService,
        private readonly menus: MenuService,
        private readonly contextKeys: ContextKeyService,
        private readonly configuration: IConfigurationService,
    ) {
        super();
        this.view = new EditorPartElement();
        this.view.id = "editorPart";
        this.view.onDidChangeWeights = () => {
            this.onDidChangeGroupLayout?.();
        };
        this.register(
            groups.onDidGroupsChange((event) => {
                this.syncGroups(event);
            }),
        );
        groups.canAddGroupHook = () => this.view.canFit(this.groups.groups.length + 1);
        groups.focusGroupContentHook = (group) => {
            this.groupComponents.get(group.id)?.focusContent();
        };
        // Работать в невидимой группе нельзя — максимизация следует за активной.
        this.register(
            groups.onDidActiveGroupChange(() => {
                if (this.view.maximizedIndex !== null) {
                    this.view.maximizedIndex = this.activeGroupIndex();
                }
            }),
        );
        this.register({
            dispose: () => {
                for (const component of this.groupComponents.values()) component.dispose();
                this.groupComponents.clear();
            },
        });
        this.syncGroups(null);
    }

    public get orientation(): EditorPartOrientation {
        return this.view.orientation;
    }

    public set orientation(value: EditorPartOrientation) {
        this.view.orientation = value;
    }

    /** Группы и доли сохраняются. */
    public toggleOrientation(): void {
        this.view.orientation = this.view.orientation === "columns" ? "rows" : "columns";
        this.onDidChangeGroupLayout?.();
    }

    public get weights(): readonly number[] {
        return this.view.weights;
    }

    public canFitGroups(count: number): boolean {
        return this.view.canFit(count);
    }

    /** Без событий персиста. */
    public applyPersistedLayout(orientation: EditorPartOrientation, weights: readonly number[]): void {
        this.view.orientation = orientation;
        this.view.setWeights(weights);
    }

    public evenWeights(): void {
        this.view.evenWeights();
    }

    public nudgeActiveGroup(deltaCells: number): void {
        this.view.nudgeWeight(this.activeGroupIndex(), deltaCells);
    }

    public toggleMaximizeActiveGroup(): void {
        const index = this.activeGroupIndex();
        this.view.maximizedIndex = this.view.maximizedIndex === index ? null : index;
    }

    private activeGroupIndex(): number {
        return this.groups.groups.indexOf(this.groups.activeGroup);
    }

    public groupOverlayHost(groupId: GroupId): OverlayHostElement | null {
        return this.groupComponents.get(groupId)?.view ?? null;
    }

    /**
     * Сплит делит долю источника пополам с новой группой; удаление — доля уходит в
     * нормировку; без события (первичная сборка) — поровну.
     */
    private syncGroups(event: IGroupsChangeEvent | null): void {
        const groups = this.groups.groups;
        // Прежние доли — из элемента: там же живут результаты drag'а.
        const previousWeights = new Map<GroupId, number>();
        // Элемент нормирует weights к числу views, а currentOrder — подмножество
        // детей-вьюх: индекс всегда валиден.
        for (const [i, component] of this.currentOrder().entries()) {
            previousWeights.set(component, this.view.weights[i]);
        }

        const alive = new Set<GroupId>(groups.map((group) => group.id));
        for (const [id, component] of [...this.groupComponents]) {
            if (!alive.has(id)) {
                component.dispose();
                this.groupComponents.delete(id);
            }
        }
        for (const group of groups) {
            if (!this.groupComponents.has(group.id)) {
                this.groupComponents.set(
                    group.id,
                    new EditorGroupComponent(group, this.editorService, this.contextMenuService, this.groups, {
                        menus: this.menus,
                        configuration: this.configuration,
                        contextKeys: this.contextKeys,
                        contextMenu: this.contextMenuService,
                    }),
                );
            }
        }

        const weights = groups.map((group) => {
            const existing = previousWeights.get(group.id);
            if (existing !== undefined && existing > 0) return existing;
            if (event?.kind === "added" && event.group.id === group.id && event.source !== undefined) {
                const sourceWeight = previousWeights.get(event.source.id);
                /* v8 ignore start -- у живого источника сплита всегда положительная нормированная доля */
                if (sourceWeight !== undefined && sourceWeight > 0) return sourceWeight / 2;
                /* v8 ignore stop */
            }
            return 1 / Math.max(1, groups.length);
        });
        if (event?.kind === "added" && event.source !== undefined) {
            const sourceIndex = groups.indexOf(event.source);
            const sourceWeight = previousWeights.get(event.source.id);
            /* v8 ignore start -- источник сплита жив (есть в groups) и несёт положительную нормированную долю */
            if (sourceIndex >= 0 && sourceWeight !== undefined && sourceWeight > 0) {
                weights[sourceIndex] = sourceWeight / 2;
            }
            /* v8 ignore stop */
        }

        this.view.setViews(
            groups.map((group) => {
                const component = this.groupComponents.get(group.id);
                /* v8 ignore start -- компонент создан циклом выше */
                if (component === undefined) throw new Error("editor part: группа без контрола");
                /* v8 ignore stop */
                return component.view;
            }),
            weights,
        );
    }

    private currentOrder(): GroupId[] {
        const order: GroupId[] = [];
        for (const child of this.view.getChildren()) {
            for (const [id, component] of this.groupComponents) {
                if (component.view === child) {
                    order.push(id);
                    break;
                }
            }
        }
        return order;
    }
}
