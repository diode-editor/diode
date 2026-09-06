import { Disposable, type IDisposable } from "@tuidom/core/common/disposable";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import type { EditorService } from "../../../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";

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
            .replace(/\u0000(\d+)\u0000/g, (_all, index: string) => escaped[Number(index)])
            .trim()
    );
}

/**
 * Логика hover'а. По команде (`editor.action.showHover` / Ctrl+K Ctrl+I)
 * запрашивает hover'ы у `EditorService.hoverSource` (провайдеры расширений
 * через host) для позиции каретки и показывает попап {@link HoverComponent}:
 * по блоку на провайдера, блоки разделяются линией (VS Code мержит hover'ы
 * так же). Закрывается по Escape, правке, движению каретки и уходу фокуса.
 */
export class HoverService extends Disposable {
    public static dependencies = [HoverComponentDIToken, EditorServiceDIToken] as const;

    /** Guard от устаревших ответов: пока ходили за hover'ом, запрос мог смениться. */
    private requestSeq = 0;
    private contentSub: IDisposable | null = null;
    private caretSub: IDisposable | null = null;

    public constructor(
        private readonly component: HoverComponent,
        private readonly group: EditorService,
    ) {
        super();
        // «Всегда-включённая» подписка на активный редактор: правка или движение
        // каретки закрывают попап (VS Code-like; сам показ — только по команде).
        const activeEditorSub = this.group.onActiveEditorChanged((editor) => {
            this.bindEditor(editor);
        });
        // Стартовая привязка — для случая, когда редактор уже открыт к моменту
        // сборки сервиса (восстановленная сессия). В харнессе файл открывают
        // после конструктора, и туда приходит onActiveEditorChanged — поэтому
        // пропуск этого вызова юнит-тестом не наблюдается.
        // Stryker disable next-line CallExpression: см. выше — привязку уже открытого редактора юнит не наблюдает, её путь проверяет поднятие приложения
        this.bindEditor(this.group.getActiveEditor());
        this.register({
            dispose: () => {
                activeEditorSub.dispose();
                // Stryker disable next-line CallExpression: снятие подписок на выключении ненаблюдаемо юнитом — дерево умирает следом
                this.unbindEditor();
            },
        });
    }

    /**
     * Запрашивает hover'ы для позиции каретки и показывает попап. No-op, если
     * нет активного редактора, источника, провайдеры ничего не вернули или
     * каретка вне вьюпорта.
     */
    public async showHover(): Promise<void> {
        const editor = this.group.getActiveEditor();
        if (editor === null) return;
        const source = this.group.hoverSource;
        if (source === undefined) return;

        const caret = editor.viewState.selections[0].active;
        // Stryker disable next-line UpdateOperator: сравнение идёт на равенство, поэтому направление счётчика роли не играет — важно лишь, что каждый запрос берёт свежее значение
        const seq = ++this.requestSeq;
        const hovers = await source({
            uri: editor.uri.toString(),
            languageId: editor.languageId,
            text: editor.getText(),
            line: caret.line,
            character: caret.character,
        });
        // Пока ходили за ответом, попап могли закрыть или перезапросить — старый
        // ответ не имеет права перекрыть новое состояние.
        if (seq !== this.requestSeq) return;

        // Блок на провайдера: контент одного hover'а склеивается пустой строкой,
        // блоки разных провайдеров разделит линией сам элемент.
        const blocks = hovers
            .map((hover) => hover.contents.map(stripMarkdown).filter((text) => text !== "").join("\n\n"))
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
        // Ответ «в полёте» больше не нужен: его seq устареет и будет отброшен.
        // Stryker disable next-line UpdateOperator: сдвиг счётчика в любую сторону делает «летящий» seq неравным — направление роли не играет
        this.requestSeq++;
    }

    /** Фокус ушёл с редактора (Ctrl+Tab, Quick Open) — попап без якоря не жилец. */
    public onFocusChanged(editorFocused: boolean): void {
        if (!editorFocused && this.isOpen()) this.close();
    }

    private bindEditor(editor: TextEditorPane | null): void {
        this.unbindEditor();
        this.close();
        if (editor === null) return;
        this.contentSub = editor.onDidChangeContent(() => {
            if (this.isOpen()) this.close();
        });
        this.caretSub = editor.onDidChangeCursorPosition(() => {
            if (this.isOpen()) this.close();
        });
    }

    private unbindEditor(): void {
        // Stryker disable next-line OptionalChaining: до первой привязки подписок нет — обращение к dispose несуществующей кинуло бы на старте
        this.contentSub?.dispose();
        this.contentSub = null;
        // Stryker disable next-line OptionalChaining: см. выше
        this.caretSub?.dispose();
        this.caretSub = null;
    }
}
