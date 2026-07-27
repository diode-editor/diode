import type { ITerminalBackend } from "../backend/iTerminalBackend.ts";
import { BoxConstraints, Offset, Point, Rect, Size } from "../common/geometryPromitives.ts";
import type { KeyPressEvent } from "../input/keyEvent.ts";
import type { MouseToken } from "../input/rawTerminalToken.ts";
import { TerminalScreen } from "../rendering/terminalScreen.ts";

import { contextMenuEventFromKeydown } from "./events/contextMenuEventSource.ts";
import { FocusManager } from "./events/focusManager.ts";
import { MouseEventDispatcher } from "./events/mouseEventDispatcher.ts";
import { TUIKeyboardEvent } from "./events/tuiKeyboardEvent.ts";
import { TUIPasteEvent } from "./events/tuiPasteEvent.ts";
import { ROOT_RESOLVED_STYLE } from "./styles/tuiStyle.ts";
import { RenderContext, type TUIElement } from "./tuiElement.ts";
import { assertValidTree } from "./validateTree.ts";

export class TuiApplication {
    public backend: ITerminalBackend;

    public root: TUIElement | null = null;
    public screen: TerminalScreen;
    public focusManager: FocusManager | null = null;
    public mouseDispatcher: MouseEventDispatcher = new MouseEventDispatcher();
    private renderScheduled = false;
    /**
     * Прогонять {@link assertValidTree} после каждого кадра. Включено в тестовых
     * харнессах (TestApp) и опционально в приложении (env VEXX_VALIDATE_TREE=1):
     * забытый setParent / неукоренённое поддерево падают громко на первом же
     * кадре, а не молчаливым «не показывается / не кликается».
     */
    public validateTreeAfterRender = false;
    // Монотонный счётчик отрисованных кадров. Инкремент на каждый renderFrame —
    // инспектор ждёт «рендер устоялся» (frameCount не менялся + нет
    // запланированного рендера), не завися от sleep. См. inspector/idleWaiter.
    private frameCounter = 0;
    // Цель keydown, закреплённая за парным keypress того же физического нажатия
    // (см. handleInput).
    private pinnedKeypressTarget: TUIElement | null = null;

    public constructor(backend: ITerminalBackend) {
        this.backend = backend;
        this.screen = new TerminalScreen(backend.getSize());
    }

    /** Сколько кадров отрисовано с запуска. Растёт при каждой перерисовке. */
    public get frameCount(): number {
        return this.frameCounter;
    }

    /** Есть ли отложенный (setImmediate) рендер, ещё не выполненный. */
    public get isRenderScheduled(): boolean {
        return this.renderScheduled;
    }

    private renderFrame(): void {
        if (this.root) {
            this.frameCounter++;
            this.screen.clear();

            // Set root global position to (0, 0) — top-left of screen
            this.root.globalPosition = new Point(0, 0);

            // Perform layout with tight constraints based on screen size
            const constraints = BoxConstraints.tight(this.screen.size);
            this.root.performLayout(constraints);

            // Resolve styles (top-down cascade)
            this.root.performStyleResolution(ROOT_RESOLVED_STYLE);

            // Render
            const screenClip = new Rect(new Point(0, 0), this.screen.size);
            this.root.render(new RenderContext(this.screen, new Offset(0, 0), screenClip));
            this.screen.flush(this.backend);
            if (this.validateTreeAfterRender) {
                assertValidTree(this.root);
            }
        }
    }

    /**
     * Schedules a deferred render via setImmediate.
     * Batches multiple markDirty() calls into a single frame.
     * Skips rendering if layout is already clean (e.g. a synchronous
     * renderFrame from handleInput already ran).
     */
    public scheduleRender(): void {
        if (this.renderScheduled) return;
        this.renderScheduled = true;
        setImmediate(() => {
            this.renderScheduled = false;
            if (this.root?.isLayoutDirty) {
                this.renderFrame();
            }
        });
    }

    private handleInput(event: KeyPressEvent): void {
        if (this.root) {
            // Dispatch to focused element (or root) with capture/bubble
            const tuiEvent = new TUIKeyboardEvent(event.type, {
                key: event.key,
                code: event.code,
                ctrlKey: event.ctrlKey,
                shiftKey: event.shiftKey,
                altKey: event.altKey,
                metaKey: event.metaKey,
                raw: event.raw,
            });

            // Одно физическое нажатие — один логический получатель: парсер на каждый
            // keydown синтезирует keypress сразу следом, и если обработчик keydown
            // сменил фокус (оверлей закрылся, restoreFocus вернул фокус дереву),
            // парный keypress не должен «протечь» новому владельцу фокуса. Поэтому
            // цель keypress закрепляется за целью её keydown; keyup — отдельный
            // момент времени, он идёт текущему фокусу.
            let target = this.focusManager?.activeElement ?? this.root;
            if (
                event.type === "keypress" &&
                /* v8 ignore next 2 -- defensive: keypress эмитится парсером только сразу после парного keydown, который уже выставил пин */
                this.pinnedKeypressTarget !== null
            ) {
                target = this.pinnedKeypressTarget;
            }
            this.pinnedKeypressTarget = event.type === "keydown" ? target : null;
            const notPrevented = target.dispatchEvent(tuiEvent);

            // Клавиатурный запрос контекстного меню (ContextMenu / Shift+F10)
            // синтезируется в общее событие "contextmenu" — только если keydown
            // не съеден (глобальный кейбинд делает preventDefault сам).
            if (notPrevented && event.type === "keydown") {
                const contextMenuEvent = contextMenuEventFromKeydown(tuiEvent, target);
                if (contextMenuEvent) {
                    target.dispatchEvent(contextMenuEvent);
                }
            }

            // Tab focus cycling (default behavior if not prevented, only on keydown)
            if (notPrevented && event.key === "Tab" && event.type === "keydown" && this.focusManager) {
                const direction = event.shiftKey ? "backward" : "forward";
                this.focusManager.cycleFocus(direction);
            }

            this.renderFrame();
        }
    }

    private handlePaste(text: string): void {
        if (this.root) {
            const event = new TUIPasteEvent(text);
            const target = this.focusManager?.activeElement ?? this.root;
            target.dispatchEvent(event);
            this.renderFrame();
        }
    }

    private handleMouse(token: MouseToken): void {
        if (this.root) {
            this.mouseDispatcher.handleMouseToken(token, this.root);
            this.renderFrame();
        }
    }

    private handleResize(size: Size): void {
        this.screen = new TerminalScreen(size);
        // Mark root as dirty so next render recalculates layout
        if (this.root) {
            this.root.markDirty();
        }
        this.renderFrame();
    }

    public run(): void {
        // Set up focus manager on root
        if (this.root) {
            this.focusManager = new FocusManager(this.root);
            this.root.focusManager = this.focusManager;
            this.root.setRequestRenderCallback(() => {
                this.scheduleRender();
            });
        }

        this.backend.setup();

        this.backend.onInput((event) => {
            this.handleInput(event);
        });

        this.backend.onResize((size) => {
            this.handleResize(size);
        });

        this.backend.onPaste((text) => {
            this.handlePaste(text);
        });

        this.backend.onMouse((token) => {
            this.handleMouse(token);
        });

        // Initial render
        this.renderFrame();
    }
}
