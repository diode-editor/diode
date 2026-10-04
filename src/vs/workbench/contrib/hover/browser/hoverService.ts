import { LatestRequest } from "../../../../base/common/cancellation.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import { EditorElement } from "../../../../editor/browser/editorElement.ts";
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { bindActiveEditor } from "../../../services/editor/browser/activeEditorBinding.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import type { FocusTracker } from "../../../services/focus/browser/focusTracker.ts";
import { FocusTrackerDIToken } from "../../../services/focus/browser/focusTracker.ts";

import { getHovers } from "./getHover.ts";
import type { HoverComponent } from "./hoverComponent.ts";
import { HoverComponentDIToken } from "./hoverComponent.ts";

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const HoverServiceDIToken = token<HoverService>("HoverService");

/**
 * Стрип подмножества markdown в плоский текст для TUI-попапа: fenced-ограждения
 * снимаются (содержимое остаётся), инлайн-`код`, **жирный**, *курсив* и ссылки
 * разворачиваются в текст. Рендерера markdown нет (docs/TODO/LSP.md) — это
 * осознанный v1; мини-рендерер со StyleFlags — отдельной задачей.
 */
export function stripMarkdown(value: string): string {
    // Экранированные символы прячем ПЕРВЫМИ (приём stripSnippetPlaceholders):
    // иначе `\*текст\*` разобрался бы по пути как «курсив».
    // Stryker disable next-line ArrayDeclaration: аккумулятор пряток — затравка перетирается первой же записью, а без экранированных символов он не читается вовсе
    const escaped: string[] = [];
    const hidden = value.replace(/\\([\\`*_{}[\]()#+\-.!])/g, (_all, char: string) => {
        escaped.push(char);
        return "\u0000" + String(escaped.length - 1) + "\u0000";
    });
    return (
        hidden
            // Fenced-блок: ограждения долой, содержимое как есть.
            .replace(/```[^\n]*\n([\s\S]*?)\n?```/g, "$1")
            .replace(/`([^`]+)`/g, "$1")
            .replace(/\*\*([^*]+)\*\*/g, "$1")
            .replace(/__([^_]+)__/g, "$1")
            .replace(/\*([^*]+)\*/g, "$1")
            // Ссылки: [текст](url) → текст.
            .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
            // eslint-disable-next-line no-control-regex -- \u0000 здесь и есть служебный маркер, которым выше спрятаны экранированные символы
            .replace(/\u0000(\d+)\u0000/g, (_all, index: string) => escaped[Number(index)])
            .trim()
    );
}

/**
 * Логика hover'а. По команде (`editor.action.showHover` / Ctrl+K Ctrl+I)
 * запрашивает hover'ы у подошедших документу провайдеров реестра
 * `ILanguageFeaturesService.hoverProvider` для позиции каретки и показывает попап {@link HoverComponent}:
 * по блоку на провайдера, блоки разделяются линией (VS Code мержит hover'ы
 * так же). Закрывается по Escape, правке, движению каретки и уходу фокуса.
 */
export class HoverService extends Disposable implements IContextKeyContributor {
    public static dependencies = [
        HoverComponentDIToken,
        EditorServiceDIToken,
        FocusTrackerDIToken,
        LanguageFeaturesServiceDIToken,
    ] as const;

    /** Guard от устаревших ответов: пока ходили за hover'ом, запрос мог смениться. */
    private readonly latest = new LatestRequest();

    public constructor(
        private readonly component: HoverComponent,
        private readonly group: IEditorService,
        focusTracker: FocusTracker,
        private readonly languageFeatures: ILanguageFeaturesService,
    ) {
        super();
        // Фокус ушёл с редактора (Ctrl+Tab, Quick Open) — попап без якоря не жилец.
        this.register(
            focusTracker.onDidChangeFocus((active) => {
                if (!(active instanceof EditorElement) && this.isOpen()) this.close();
            }),
        );
        // «Всегда-включённая» подписка на активный редактор: правка или движение
        // каретки закрывают попап (VS Code-like; сам показ — только по команде).
        this.register(
            bindActiveEditor(this.group, (editor, store) => {
                // Смена редактора при открытом попапе в приложении уже сопровождается
                // сменой фокуса (её ловит подписка на FocusTracker), поэтому в юните пропуск этого
                // закрытия не наблюдается — вызов держим для программной смены редактора
                // без участия фокуса (восстановление сессии, split).
                // Stryker disable next-line CallExpression: см. выше
                this.close();
                if (editor === null) return;
                // Одной подписки на каретку достаточно и для правок: правка двигает
                // (или пересчитывает) каретку, и событие приходит в том же тике —
                // отдельная подписка на контент оказалась мёртвым кодом.
                store.add(
                    editor.onDidChangeCursorPosition(() => {
                        // Stryker disable next-line ConditionalExpression: close() на закрытом попапе — no-op, поэтому проверка экономит вызов, а не меняет поведение
                        if (this.isOpen()) this.close();
                    }),
                );
            }),
        );
    }

    /**
     * Запрашивает hover'ы для позиции каретки и показывает попап. No-op, если
     * нет активного редактора, провайдеры ничего не вернули или каретка вне
     * вьюпорта. Документ без подошедших провайдеров запросов не порождает.
     */
    public async showHover(): Promise<void> {
        const editor = this.group.getActiveEditor();
        if (editor === null) return;

        const caret = editor.viewState.selections[0].active;
        const ticket = this.latest.start();
        const hovers = await getHovers(
            this.languageFeatures.hoverProvider,
            editor,
            {
                uri: editor.uri.toString(),
                languageId: editor.languageId,
                versionId: editor.model.document.versionId,
                line: caret.line,
                character: caret.character,
            },
            // Перезапрос и закрытие попапа отменяют запрос и у провайдера.
            ticket.token,
        );
        // Пока ходили за ответом, попап могли закрыть или перезапросить — старый
        // ответ не имеет права перекрыть новое состояние.
        if (ticket.isStale()) return;

        // Блок на провайдера: контент одного hover'а склеивается пустой строкой,
        // блоки разных провайдеров разделит линией сам элемент.
        const blocks = hovers
            .map((hover) =>
                hover.contents
                    .map(stripMarkdown)
                    .filter((text) => text !== "")
                    .join("\n\n"),
            )
            .filter((block) => block !== "");
        if (blocks.length === 0) return;

        // Каретка могла уйти за время await — берём актуальный якорь.
        const anchor = editor.getCaretAnchor();
        if (anchor === null) return;

        this.component.setBlocks(blocks);
        this.component.openAt(anchor);
    }

    /** Открыт ли попап (для `editorHoverVisible` и Escape-экшена). */
    public isOpen(): boolean {
        return this.component.isOpen();
    }

    public close(): void {
        this.component.close();
        // Ответ «в полёте» больше не нужен: его билет устареет и ответ будет отброшен.
        this.latest.cancel();
    }

    /** IContextKeyContributor: `editorHoverVisible` — гейт Escape и навигации по попапу. */
    public updateContextKeys(contextKeys: ContextKeyService): void {
        contextKeys.set("editorHoverVisible", this.isOpen());
    }
}
