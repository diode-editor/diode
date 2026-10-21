import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IRegistryExtensionMeta } from "../../../../platform/extensionManagement/common/registryFormat.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import type {
    IExtensionListEntry,
    IExtensionOperationResult,
    IExtensionsWorkbenchService,
} from "../common/extensionsWorkbench.ts";

import type { IExtensionPageActions } from "./extensionPageActions.ts";
import type { ExtensionButtonKind } from "./extensionPageButtons.ts";
import { describeExtensionButtons } from "./extensionPageButtons.ts";
import type { IExtensionPageContent } from "./extensionPageContent.ts";
import { ExtensionPageElement } from "./extensionPageElement.ts";

/** Идентичность вкладки, а не файл: по ней `EditorService.openPane` переключается на уже открытую страницу. */
export const EXTENSION_SCHEME = "extension";

export function extensionUri(id: string): Uri {
    return Uri.from({ scheme: EXTENSION_SCHEME, path: id });
}

/**
 * Без текстовой проекции — `viewState` нет, команды курсора её не видят. Подписана на сервис:
 * карточка может смениться, пока вкладка открыта.
 */
export class ExtensionEditorPane extends Disposable implements IEditorPane {
    public readonly uri: Uri;
    public readonly view: TUIElement;
    public readonly isModified = false;
    public readonly readOnly = true;

    private readonly element: ExtensionPageElement;
    private readonly onDidChangeStateEmitter = this.register(new Emitter<void>());
    private labelValue: string;
    private busy = false;
    /** Монотонный и живёт в панели: удалённое расширение вне реестра из карточек исчезает, а про перезагрузку сказать надо. */
    private needsReload: boolean;
    private operationError: string | null = null;

    public constructor(
        private readonly service: IExtensionsWorkbenchService,
        private readonly actions: IExtensionPageActions,
        private entry: IExtensionListEntry,
        private readonly meta: IRegistryExtensionMeta | undefined,
        private readonly metaError: string | null,
    ) {
        super();
        this.uri = extensionUri(entry.id);
        this.labelValue = entry.displayName;
        this.needsReload = entry.needsReload;
        this.element = new ExtensionPageElement(this.content(), this.buttons(), (kind) => {
            this.activateButton(kind);
        });
        // Точки в id — вне алфавита селектора инспектора (`#id`), как у контейнеров view.
        this.element.id = `extensionPage-${entry.id.replaceAll(".", "-")}`;
        this.element.style = { fg: "editor.foreground", bg: "editor.background" };
        this.view = this.element;

        this.register(
            service.onDidChange(() => {
                this.syncEntry();
            }),
        );
    }

    public get label(): string {
        return this.labelValue;
    }

    public getSelectedTexts(): string[] {
        return [];
    }

    public readonly onDidChangeState = this.onDidChangeStateEmitter.event;

    public focusEditor(): void {
        this.element.focus();
    }

    private content(): IExtensionPageContent {
        return {
            entry: this.entry,
            meta: this.meta,
            metaError: this.metaError,
            operationError: this.operationError,
        };
    }

    private buttons(): ReturnType<typeof describeExtensionButtons> {
        return describeExtensionButtons(this.entry, { busy: this.busy, needsReload: this.needsReload });
    }

    private render(): void {
        this.element.setContent(this.content(), this.buttons());
    }

    private activateButton(kind: ExtensionButtonKind): void {
        if (kind === "reload") {
            this.actions.reloadWindow();
            return;
        }
        if (kind === "uninstall") {
            void this.runOperation(() => this.actions.uninstall(this.entry.id));
            return;
        }
        // install и update — одна и та же операция: установка сносит прежние версии.
        void this.runOperation(() => this.actions.install(this.entry.id));
    }

    private async runOperation(run: () => Promise<IExtensionOperationResult>): Promise<void> {
        this.busy = true;
        this.operationError = null;
        this.render();
        const result = await run();
        this.busy = false;
        if (!result.ok) {
            this.operationError = result.error;
            this.render();
            return;
        }
        this.needsReload = true;
        this.render();
        // Фокус встаёт на первую кнопку — а первой теперь стоит Reload Window.
        this.element.focus();
    }

    private syncEntry(): void {
        const fresh = this.service.getEntries().find((e) => e.id === this.entry.id);
        if (fresh === undefined) {
            // Карточка исчезла — удалено и вне реестра. Чужую вкладку под пользователем не закрываем.
            this.entry = { ...this.entry, installedVersion: null };
            this.render();
            return;
        }
        this.entry = fresh;
        // Флаг монотонный: снять его может только перезагрузка окна.
        this.needsReload = this.needsReload || fresh.needsReload;
        this.render();
        if (fresh.displayName !== this.labelValue) {
            this.labelValue = fresh.displayName;
            this.onDidChangeStateEmitter.fire();
        }
    }
}
