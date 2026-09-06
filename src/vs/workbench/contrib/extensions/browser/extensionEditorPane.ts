import type { IDisposable } from "@tuidom/core/common/disposable";
import { Disposable } from "@tuidom/core/common/disposable";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { Uri } from "../../../../base/common/uri.ts";
import type { IRegistryExtensionMeta } from "../../../../platform/extensionManagement/common/registryFormat.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import type { IExtensionListEntry, IExtensionsWorkbenchService } from "../common/extensionsWorkbench.ts";

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
 * Вкладка расширения: метаданные записи и readme реестра (см.
 * {@link ExtensionPageElement}). Read-only и без текстовой проекции —
 * `viewState` у неё нет, поэтому команды курсора её просто не видят.
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

    public constructor(
        private readonly service: IExtensionsWorkbenchService,
        private entry: IExtensionListEntry,
        private readonly meta: IRegistryExtensionMeta | undefined,
        private readonly metaError: string | null,
    ) {
        super();
        this.uri = extensionUri(entry.id);
        this.labelValue = entry.displayName;
        this.element = new ExtensionPageElement({ entry, meta, metaError });
        // Точки в id — вне алфавита селектора инспектора (`#id`), как у контейнеров view.
        this.element.id = `extensionPage-${entry.id.replaceAll(".", "-")}`;
        this.element.style = { fg: "editor.foreground", bg: "editor.background" };
        this.view = this.element;

        this.register(service.onDidChange(() => this.syncEntry()));
        this.register({
            dispose: () => {
                this.stateListeners.clear();
            },
        });
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

    /**
     * Перечитывает карточку из сервиса. Расширение, удалённое из каталога и с
     * диска, из списка карточек исчезает — страницу при этом не закрываем:
     * закрывать чужую вкладку под пользователем хуже, чем показать последнее
     * известное состояние.
     */
    private syncEntry(): void {
        const fresh = this.service.getEntries().find((e) => e.id === this.entry.id);
        if (fresh === undefined) return;
        this.entry = fresh;
        this.element.setContent({ entry: fresh, meta: this.meta, metaError: this.metaError });
        if (fresh.displayName !== this.labelValue) {
            this.labelValue = fresh.displayName;
            for (const listener of [...this.stateListeners]) listener();
        }
    }
}
