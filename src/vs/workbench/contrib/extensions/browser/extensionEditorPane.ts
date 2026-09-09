import type { IDisposable } from "@tuidom/core/common/disposable";
import { Disposable } from "@tuidom/core/common/disposable";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
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

/**
 * Схема ресурса вкладки расширения. Настоящего файла за ней нет — это
 * идентичность вкладки: `EditorService.openPane` по ней и переключается на уже
 * открытую страницу вместо второй такой же (как `diff:` у дифф-вкладки).
 */
export const EXTENSION_SCHEME = "extension";

/** Ресурс страницы расширения по его id. */
export function extensionUri(id: string): Uri {
    return Uri.from({ scheme: EXTENSION_SCHEME, path: id });
}

/**
 * Вкладка расширения: метаданные записи, кнопки установки/удаления и readme
 * реестра (см. {@link ExtensionPageElement}). Read-only и без текстовой
 * проекции — `viewState` у неё нет, поэтому команды курсора её просто не видят.
 *
 * Страница живёт дольше одного показа: состояние расширения может смениться,
 * пока вкладка открыта (установка, удаление, Refresh каталога), — поэтому
 * панель подписана на сервис и перечитывает свою карточку по событию.
 */
export class ExtensionEditorPane extends Disposable implements IEditorPane {
    public readonly uri: Uri;
    public readonly view: TUIElement;
    public readonly isModified = false;
    public readonly readOnly = true;

    private readonly element: ExtensionPageElement;
    private readonly stateListeners = new Set<() => void>();
    private labelValue: string;
    /** Идёт установка/удаление: кнопки гаснут, вторая операция не запускается. */
    private busy = false;
    /**
     * Ждём перезагрузки окна. Флаг монотонный и живёт в панели, а не только в
     * карточке: удалённое расширение, которого нет в реестре, из карточек
     * исчезает — а сказать про перезагрузку всё равно надо.
     */
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

        this.register(service.onDidChange(() => this.syncEntry()));
    }

    public get label(): string {
        return this.labelValue;
    }

    public getSelectedTexts(): string[] {
        return [];
    }

    public onDidChangeState(cb: () => void): IDisposable {
        this.stateListeners.add(cb);
        return { dispose: () => this.stateListeners.delete(cb) };
    }

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

    /** Нажали кнопку шапки. */
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

    /**
     * Гоняет операцию с гашением кнопок. Ошибка остаётся на странице текстом, а
     * кнопки снова доступны — повторить можно тут же.
     */
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

    /** Перечитывает карточку из сервиса (установка, удаление, Refresh каталога). */
    private syncEntry(): void {
        const fresh = this.service.getEntries().find((e) => e.id === this.entry.id);
        if (fresh === undefined) {
            // Карточка исчезла — значит расширение удалено и записи в реестре у
            // него нет. Вкладку не закрываем (закрывать чужую под пользователем
            // хуже), но врать про «установлено» она больше не должна.
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
            for (const listener of [...this.stateListeners]) listener();
        }
    }
}
