import { MockTerminalBackend } from "@tuidom/all/backend/mockTerminalBackend";
import type { IDisposable } from "@tuidom/all/common/disposable";
import { TUIMouseEvent } from "@tuidom/all/dom/events/tuiMouseEvent";
import type { HFlexElement, HFlexLayoutStyle } from "@tuidom/all/ui/layout/hFlexElement";
import { TextLabelElement } from "@tuidom/all/ui/text/textLabelElement";
import type { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { TextDocument } from "../../../../editor/common/model/textDocument.ts";
import { EditorViewState } from "../../../../editor/common/viewModel/editorViewState.ts";
import { MenuRegistry } from "../../../../platform/actions/common/menuRegistry.ts";
import { MenuService } from "../../../../platform/actions/common/menuService.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import { StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";
import { TerminalEnvironmentService } from "../../../services/terminalEnvironment/node/terminalEnvironmentService.ts";
import { TerminalEnvStatusContribution } from "../../../services/terminalEnvironment/node/terminalEnvStatusContribution.ts";
import type { IActiveEditorStatus, IActiveEditorStatusSource } from "../editor/editorStatusContribution.ts";
import { EditorStatusContribution } from "../editor/editorStatusContribution.ts";

import { StatusBarComponent } from "./statusBarComponent.ts";

/**
 * Тестовый редактор для сегментов статус-бара: реализует {@link IActiveEditorStatus}
 * поверх настоящих `TextDocument` + `EditorViewState` (курсор/EOL/язык ведут себя
 * как в проде и файрят те же события); только кодировка — собственное поле.
 */
export class FakeStatusEditor implements IActiveEditorStatus {
    public readonly viewState: EditorViewState;
    private readonly doc: TextDocument;
    private encodingValue = "utf8";
    private readonly encodingListeners = new Set<() => void>();

    public constructor(text = "", languageId = "plaintext") {
        this.doc = new TextDocument(text, languageId);
        this.viewState = new EditorViewState(this.doc);
    }

    public get eol(): EndOfLine {
        return this.doc.eol;
    }

    public get languageId(): string {
        return this.doc.languageId;
    }

    public get encoding(): string {
        return this.encodingValue;
    }

    public setEol(eol: EndOfLine): void {
        this.doc.setEol(eol);
    }

    public setLanguage(languageId: string): void {
        this.doc.setLanguage(languageId);
    }

    public setEncoding(encoding: string): void {
        this.encodingValue = encoding;
        for (const listener of [...this.encodingListeners]) listener();
    }

    public onDidChangeCursorPosition(listener: () => void): IDisposable {
        return this.viewState.onDidChangeCursorPosition(listener);
    }

    public onDidChangeLanguage(listener: () => void): IDisposable {
        return this.doc.onDidChangeLanguage(listener);
    }

    public onDidChangeEol(listener: () => void): IDisposable {
        return this.doc.onDidChangeEol(listener);
    }

    public onDidChangeEncoding(listener: () => void): IDisposable {
        this.encodingListeners.add(listener);
        return { dispose: () => this.encodingListeners.delete(listener) };
    }
}

/** Источник активного редактора: аналог EditorService в один экран кода. */
export class FakeActiveEditorSource implements IActiveEditorStatusSource {
    private active: FakeStatusEditor | null = null;
    private readonly listeners = new Set<(editor: IActiveEditorStatus | null) => void>();

    public getActiveEditor(): FakeStatusEditor | null {
        return this.active;
    }

    public onActiveEditorChanged(listener: (editor: IActiveEditorStatus | null) => void): IDisposable {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    public setActiveEditor(editor: FakeStatusEditor | null): void {
        this.active = editor;
        for (const listener of [...this.listeners]) listener(editor);
    }

    /** «Открывает файл»: создаёт редактор и делает его активным. */
    public openEditor(text = "", languageId = "plaintext"): FakeStatusEditor {
        const editor = new FakeStatusEditor(text, languageId);
        this.setActiveEditor(editor);
        return editor;
    }
}

export interface IStatusSegment {
    text: string;
    side: "left" | "right";
}

/**
 * Текст сегмента без краевых пробелов, которыми компонент обкладывает запись
 * (они — часть блока подсветки, а не содержимого). Тесты состава смотрят на
 * содержимое; за сами пробелы отвечает пофреймовый render-тест.
 */
function segmentText(label: TextLabelElement): string {
    return label.getText().slice(1, -1);
}

/**
 * Сегменты полосы в порядке отрисовки: обход детей hflex — лейблы до
 * fill-ребёнка (centerFill) относятся к левой стороне, после — к правой.
 * Паддинги (Filler) пропускаются.
 */
export function statusSegments(view: HFlexElement): IStatusSegment[] {
    const segments: IStatusSegment[] = [];
    let side: "left" | "right" = "left";
    for (const child of view.getChildren()) {
        if ((child.layoutStyle as HFlexLayoutStyle).width.type === "fill") {
            side = "right";
            continue;
        }
        if (child instanceof TextLabelElement) {
            segments.push({ text: segmentText(child), side });
        }
    }
    return segments;
}

/** Тексты сегментов в порядке отрисовки (без разделения по сторонам). */
export function statusTexts(view: HFlexElement): string[] {
    return statusSegments(view).map((segment) => segment.text);
}

/** Кликает по сегменту с данным текстом — наблюдаемый клик, не шов. */
export function clickSegment(view: HFlexElement, text: string): void {
    const label = view
        .getChildren()
        .find((child): child is TextLabelElement => child instanceof TextLabelElement && segmentText(child) === text);
    if (!label) throw new Error(`status bar has no segment "${text}"`);
    label.dispatchEvent(new TUIMouseEvent("click", { button: "left", screenX: 0, screenY: 0, localX: 0, localY: 0 }));
}

export interface StatusBarHarness {
    component: StatusBarComponent;
    statusBarService: StatusBarService;
    contextMenuService: ContextMenuService;
    source: FakeActiveEditorSource;
    commands: CommandRegistry;
    terminalEnv: TerminalEnvironmentService;
    editorContribution: EditorStatusContribution;
    terminalContribution: TerminalEnvStatusContribution;
}

/**
 * Собирает полную связку статус-бара без DI-контейнера:
 * StatusBarService + оба contribution'а + StatusBarComponent. Терминальное
 * окружение — настоящий `TerminalEnvironmentService` (тесты чистят env-переменные,
 * чтобы сегмент детерминированно резолвился в "legacy").
 */
export function createStatusBarHarness(languageService: ILanguageService = NULL_LANGUAGE_SERVICE): StatusBarHarness {
    const statusBarService = new StatusBarService(NULL_STATE_SERVICE);
    const commands = new CommandRegistry();
    // Меню полосы реестровых пунктов не берёт (только свои от делегата),
    // поэтому реестр — пустой.
    const contextMenuService = new ContextMenuService(
        new MenuService(new MenuRegistry(commands, new KeybindingRegistry(), new ContextKeyService(), [])),
    );
    const terminalEnv = new TerminalEnvironmentService(new MockTerminalBackend(), NULL_CONFIGURATION_SERVICE);
    const source = new FakeActiveEditorSource();
    const terminalContribution = new TerminalEnvStatusContribution(statusBarService, terminalEnv);
    const editorContribution = new EditorStatusContribution(statusBarService, source, languageService, commands);
    const component = new StatusBarComponent(statusBarService, contextMenuService);
    return {
        component,
        statusBarService,
        contextMenuService,
        source,
        commands,
        terminalEnv,
        editorContribution,
        terminalContribution,
    };
}
