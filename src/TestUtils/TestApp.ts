import { MockTerminalBackend } from "../../tuidom/backend/mockTerminalBackend.ts";
import { Size } from "../../tuidom/common/geometryPromitives.ts";
import { TuiApplication } from "../../tuidom/dom/tuiApplication.ts";
import type { TUIElement } from "../../tuidom/dom/tuiElement.ts";
import { BodyElement } from "../../tuidom/ui/body/bodyElement.ts";

export class TestApp {
    public readonly backend: MockTerminalBackend;
    public readonly app: TuiApplication;

    private constructor(backend: MockTerminalBackend, root: BodyElement) {
        this.backend = backend;
        this.app = new TuiApplication(backend);
        this.app.root = root;
        this.bodyRoot = root;
        // Каждый кадр в тестах верифицирует инварианты дерева (симметрия parent,
        // укоренённость) — молчаливые полуприкреплённые состояния падают сразу.
        this.app.validateTreeAfterRender = true;
        this.app.run();
    }

    public static create(root: BodyElement, size: Size = new Size(80, 24)): TestApp {
        return new TestApp(new MockTerminalBackend(size), root);
    }

    public static createWithContent(content: TUIElement, size: Size = new Size(80, 24)): TestApp {
        const body = new BodyElement();
        body.setContent(content);
        return new TestApp(new MockTerminalBackend(size), body);
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
