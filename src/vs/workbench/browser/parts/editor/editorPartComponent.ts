import type { OverlayHostElement } from "../../../../../../tuidom/ui/contextview/overlayHostElement.ts";
import type { EditorPartOrientation } from "../../../../../../tuidom/ui/editorpart/editorPartElement.ts";
import { EditorPartElement } from "../../../../../../tuidom/ui/editorpart/editorPartElement.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { GroupId } from "../../../services/editor/browser/editorGroupModel.ts";
import type { EditorService, IGroupsChangeEvent } from "../../../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import { Component } from "../../component.ts";

import { EditorGroupComponent } from "./editorGroupComponent.ts";

export const EditorPartComponentDIToken = token<EditorPartComponent>("EditorPartComponent");

/**
 * Часть «область редактора» (аналог `EditorPart` VS Code): владеет полосой
 * групповых контролов внутри {@link EditorPartElement} (веса, саши, ось,
 * максимизация) и держит по {@link EditorGroupComponent} на группу сервиса.
 * Синхронизируется по {@link EditorService.onDidGroupsChange}; политика долей —
 * здесь: сплит делит долю группы-источника пополам, схлопнутая группа отдаёт
 * долю остальным (нормировкой). Ставит сервису view-хуки: `canAddGroupHook`
 * (влезет ли ещё группа — отказ в сплите на узком терминале) и
 * `focusGroupContentHook` (фокус вкладки либо филлера пустой группы).
 */
export class EditorPartComponent extends Component {
    public static dependencies = [EditorServiceDIToken] as const;

    public readonly view: EditorPartElement;
    private readonly groupComponents = new Map<GroupId, EditorGroupComponent>();

    public constructor(private readonly editorService: EditorService) {
        super();
        this.view = new EditorPartElement();
        this.view.id = "editorPart";
        this.register(
            editorService.onDidGroupsChange((event) => {
                this.syncGroups(event);
            }),
        );
        editorService.canAddGroupHook = () => this.view.canFit(this.editorService.groups.length + 1);
        editorService.focusGroupContentHook = (group) => {
            this.groupComponents.get(group.id)?.focusContent();
        };
        // Максимизация следует за активной группой: работать в невидимой группе
        // нельзя, поэтому смена активной перемаксимизирует полосу на неё.
        this.register(
            editorService.onDidActiveGroupChange(() => {
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

    /** Ось полосы (тумблер и персист ходят сюда через сервисные экшены). */
    public get orientation(): EditorPartOrientation {
        return this.view.orientation;
    }

    public set orientation(value: EditorPartOrientation) {
        this.view.orientation = value;
    }

    /** Тумблер оси полосы (US-19): группы и доли сохраняются. */
    public toggleOrientation(): void {
        this.view.orientation = this.view.orientation === "columns" ? "rows" : "columns";
    }

    /** Выравнивает доли групп (Reset Editor Group Sizes). */
    public evenWeights(): void {
        this.view.evenWeights();
    }

    /** Меняет основной размер активной группы на `deltaCells` за счёт соседа. */
    public nudgeActiveGroup(deltaCells: number): void {
        this.view.nudgeWeight(this.activeGroupIndex(), deltaCells);
    }

    /** Тумблер максимизации активной группы (US-24). */
    public toggleMaximizeActiveGroup(): void {
        const index = this.activeGroupIndex();
        this.view.maximizedIndex = this.view.maximizedIndex === index ? null : index;
    }

    private activeGroupIndex(): number {
        return this.editorService.groups.indexOf(this.editorService.activeGroup);
    }

    /**
     * OverlayHost активной группы — хост докнутых виджетов группы (find).
     * Метод, а не поле: хост меняется вместе с активной группой, вызывающий
     * обязан спрашивать его на каждый показ.
     */
    public activeGroupOverlayHost(): OverlayHostElement {
        /* v8 ignore next -- у каждой группы сервиса есть компонент (инвариант syncGroups) */
        const component = this.groupComponents.get(this.editorService.activeGroup.id);
        if (component === undefined) throw new Error("editor part: активная группа без контрола");
        return component.view;
    }

    /**
     * Приводит полосу контролов к списку групп сервиса. Доли: сплит — источник
     * делится пополам с новой группой; удаление — доля уходит в нормировку;
     * без события (первичная сборка) — поровну.
     */
    private syncGroups(event: IGroupsChangeEvent | null): void {
        const groups = this.editorService.groups;
        // Прежние доли по id — из элемента (там же живут результаты drag'а).
        const previousWeights = new Map<GroupId, number>();
        for (const [i, component] of this.currentOrder().entries()) {
            previousWeights.set(component, this.view.weights[i] ?? 0);
        }

        // Создаём контролы новых групп, убираем контролы умерших.
        const alive = new Set<GroupId>(groups.map((group) => group.id));
        for (const [id, component] of [...this.groupComponents]) {
            if (!alive.has(id)) {
                component.dispose();
                this.groupComponents.delete(id);
            }
        }
        for (const group of groups) {
            if (!this.groupComponents.has(group.id)) {
                this.groupComponents.set(group.id, new EditorGroupComponent(group, this.editorService));
            }
        }

        const weights = groups.map((group) => {
            const existing = previousWeights.get(group.id);
            if (existing !== undefined && existing > 0) return existing;
            // Новая группа: половина доли источника (сплит) либо равная доля.
            if (event?.kind === "added" && event.group.id === group.id && event.source !== undefined) {
                const sourceWeight = previousWeights.get(event.source.id);
                if (sourceWeight !== undefined && sourceWeight > 0) return sourceWeight / 2;
            }
            return 1 / Math.max(1, groups.length);
        });
        // Источник сплита отдаёт половину своей доли новой группе.
        if (event?.kind === "added" && event.source !== undefined) {
            const sourceIndex = groups.indexOf(event.source);
            const sourceWeight = previousWeights.get(event.source.id);
            if (sourceIndex >= 0 && sourceWeight !== undefined && sourceWeight > 0) {
                weights[sourceIndex] = sourceWeight / 2;
            }
        }

        this.view.setViews(
            groups.map((group) => {
                /* v8 ignore next -- компонент создан циклом выше */
                const component = this.groupComponents.get(group.id);
                if (component === undefined) throw new Error("editor part: группа без контрола");
                return component.view;
            }),
            weights,
        );
    }

    /** Порядок id групп, каким его видел последний setViews (для маппинга долей). */
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
