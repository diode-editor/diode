import type { TUIElement } from "../../../../../../tuidom/dom/tuiElement.ts";
import type { OverlayHostElement } from "../../../../../../tuidom/ui/contextview/overlayHostElement.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { EditorService } from "../../../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import { Component } from "../../component.ts";

import { EditorGroupComponent } from "./editorGroupComponent.ts";

export const EditorPartComponentDIToken = token<EditorPartComponent>("EditorPartComponent");

/**
 * Часть «область редактора» (аналог `EditorPart` VS Code): владеет полосой
 * групповых контролов и отдаёт workbench-у единый {@link view} для центрального
 * слота раскладки. Пока полоса состоит из одной группы, view — это view её
 * контрола; с приходом сплитов здесь появится контейнер полосы
 * (`EditorPartElement`) с сашами и весами.
 */
export class EditorPartComponent extends Component {
    public static dependencies = [EditorServiceDIToken] as const;

    public readonly view: TUIElement;
    private readonly groupComponent: EditorGroupComponent;

    public constructor(editorService: EditorService) {
        super();
        this.groupComponent = this.register(new EditorGroupComponent(editorService));
        this.view = this.groupComponent.view;
    }

    /**
     * OverlayHost активной группы — хост докнутых виджетов группы (find).
     * Метод, а не поле: с приходом сплитов хост меняется вместе с активной
     * группой, и вызывающий обязан спрашивать его на каждый показ.
     */
    public activeGroupOverlayHost(): OverlayHostElement {
        return this.groupComponent.view;
    }
}
