import { MockTerminalBackend } from "../backend/mockTerminalBackend.ts";
import { Size } from "../common/geometryPromitives.ts";
import { TuiApplication } from "../dom/tuiApplication.ts";
import type { TUIElement } from "../dom/tuiElement.ts";
import { BodyElement } from "../ui/body/bodyElement.ts";
import { DARK_PLUS_STYLE_VARS } from "./darkPlusStyleVars.ts";

export class TestApp {
    public readonly backend: MockTerminalBackend;
    public readonly app: TuiApplication;

    private constructor(backend: MockTerminalBackend, root: BodyElement, styleVars: Readonly<Record<string, number>> | null) {
        this.backend = backend;
        this.app = new TuiApplication(backend);
        this.app.root = root;
        this.bodyRoot = root;
        // Корень получает палитру var-scope до первого кадра — компоненты в
        // тестах резолвят токены в конкретные цвета. Дефолт — снапшот Dark+
        // (паритет с приложением vexx); хост может подложить свою палитру.
        if (styleVars !== null) {
            root.setStyleVars(styleVars);
        }
        // Каждый кадр в тестах верифицирует инварианты дерева (симметрия parent,
        // укоренённость) — молчаливые полуприкреплённые состояния падают сразу.
        this.app.validateTreeAfterRender = true;
        this.app.run();
    }

    public static create(
        root: BodyElement,
        size: Size = new Size(80, 24),
        styleVars: Readonly<Record<string, number>> | null = DARK_PLUS_STYLE_VARS,
    ): TestApp {
        return new TestApp(new MockTerminalBackend(size), root, styleVars);
    }

    public static createWithContent(
        content: TUIElement,
        size: Size = new Size(80, 24),
        styleVars: Readonly<Record<string, number>> | null = DARK_PLUS_STYLE_VARS,
    ): TestApp {
        const body = new BodyElement();
        body.setContent(content);
        return new TestApp(new MockTerminalBackend(size), body, styleVars);
    }

    /** Корень как BodyElement: TuiApplication хранит рут широким типом (ядро
     * tuidom не знает о виджетах), тестовый харнесс — конкретным. */
    private readonly bodyRoot: BodyElement;

    public get root(): BodyElement {
        return this.bodyRoot;
    }

    public get focusedElement(): TUIElement | null {
        return this.app.focusManager?.activeElement ?? null;
    }

    public sendKey(name: string): void {
        this.backend.sendKey(name);
    }

    public querySelector(selector: string): TUIElement | null {
        return this.root.querySelector(selector);
    }

    public querySelectorAll(selector: string): TUIElement[] {
        return this.root.querySelectorAll(selector);
    }

    public render(): void {
        // Force a synchronous render (app.run already did the initial one,
        // and handleInput renders after each key, but this is useful
        // if the test mutates state without going through input).
        // @ts-expect-error Just for testing purposes, we want to bypass the normal async render scheduling
        this.app.renderFrame();
    }
}
