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

/** Рендерера markdown нет (docs/arch/Extensions.md, «LSP и стоковые клиенты») — попап получает плоский текст. */
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
            .replace(/```[^\n]*\n([\s\S]*?)\n?```/g, "$1")
            .replace(/`([^`]+)`/g, "$1")
            .replace(/\*\*([^*]+)\*\*/g, "$1")
            .replace(/__([^_]+)__/g, "$1")
            .replace(/\*([^*]+)\*/g, "$1")
            // `_курсив_` — только на границе слова, как в CommonMark: внутри
            // `aws_instance` или `snake_case` подчёркивания остаются.
            .replace(/(^|[^\p{L}\p{N}_])_([^_\s](?:[^_]*[^_\s])?)_(?![\p{L}\p{N}_])/gu, "$1$2")
            .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
            // eslint-disable-next-line no-control-regex -- \u0000 здесь и есть служебный маркер, которым выше спрятаны экранированные символы
            .replace(/\u0000(\d+)\u0000/g, (_all, index: string) => escaped[Number(index)])
            .trim()
    );
}

const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
/** Ограждение fenced-блока: внутри него `---` — содержимое (YAML), а не разделитель. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Пустые секции остаются: по ним видно, что разделитель стоял с краю. `---` сразу под строкой
 * абзаца — подчёркивание setext-заголовка (CommonMark), а не разделитель.
 */
export function splitMarkdownSections(value: string): string[] {
    const sections: string[][] = [[]];
    let fence: string | null = null;
    let paragraph = false;
    for (const line of value.split("\n")) {
        const current = sections[sections.length - 1];
        const opener = FENCE.exec(line)?.[1];
        const ruler = THEMATIC_BREAK.exec(line)?.[1];
        if (fence !== null) {
            // Stryker disable next-line MethodExpression: ограждение — повтор одного символа, startsWith ≡ endsWith
            if (opener?.startsWith(fence[0]) === true && opener.length >= fence.length) fence = null;
            current.push(line);
            paragraph = false;
        } else if (opener !== undefined) {
            // `paragraph` сбросит первая же строка внутри блока (ветка выше).
            fence = opener;
            current.push(line);
        } else if (ruler !== undefined) {
            if (!(paragraph && ruler === "-")) sections.push([]);
            paragraph = false;
        } else {
            current.push(line);
            paragraph = line.trim() !== "";
        }
    }
    return sections.map((lines) => stripMarkdown(lines.join("\n")));
}

/** Пустые секции отбрасывает вызывающий. */
function hoverBlocks(contents: readonly string[]): string[] {
    const blocks: string[] = [];
    for (const content of contents) {
        const [first, ...rest] = splitMarkdownSections(content);
        const tail = blocks.pop() ?? "";
        blocks.push([tail, first].filter((text) => text !== "").join("\n\n"), ...rest);
    }
    return blocks;
}

export class HoverService extends Disposable implements IContextKeyContributor {
    public static dependencies = [
        HoverComponentDIToken,
        EditorServiceDIToken,
        FocusTrackerDIToken,
        LanguageFeaturesServiceDIToken,
    ] as const;

    private readonly latest = new LatestRequest();

    public constructor(
        private readonly component: HoverComponent,
        private readonly group: IEditorService,
        focusTracker: FocusTracker,
        private readonly languageFeatures: ILanguageFeaturesService,
    ) {
        super();
        this.register(
            focusTracker.onDidChangeFocus((active) => {
                if (!(active instanceof EditorElement) && this.isOpen()) this.close();
            }),
        );
        this.register(
            bindActiveEditor(this.group, (editor, store) => {
                // В приложении смену редактора сопровождает смена фокуса; это закрытие —
                // для программной смены без фокуса (восстановление сессии, split).
                // Stryker disable next-line CallExpression: см. выше
                this.close();
                if (editor === null) return;
                // Подписки на каретку хватает и для правок: правка двигает или пересчитывает
                // каретку в том же тике.
                store.add(
                    editor.onDidChangeCursorPosition(() => {
                        // Stryker disable next-line ConditionalExpression: close() на закрытом попапе — no-op, поэтому проверка экономит вызов, а не меняет поведение
                        if (this.isOpen()) this.close();
                    }),
                );
            }),
        );
    }

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
            ticket.token,
        );
        if (ticket.isStale()) return;

        const blocks = hovers.flatMap((hover) => hoverBlocks(hover.contents)).filter((block) => block !== "");
        if (blocks.length === 0) return;

        // Каретка могла уйти за время await — берём актуальный якорь.
        const anchor = editor.getCaretAnchor();
        if (anchor === null) return;

        this.component.setBlocks(blocks);
        this.component.openAt(anchor);
    }

    public isOpen(): boolean {
        return this.component.isOpen();
    }

    public close(): void {
        this.component.close();
        this.latest.cancel();
    }

    public updateContextKeys(contextKeys: ContextKeyService): void {
        contextKeys.set("editorHoverVisible", this.isOpen());
    }
}
