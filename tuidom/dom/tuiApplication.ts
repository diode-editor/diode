import type { ITerminalBackend } from "../backend/iTerminalBackend.ts";
import { BoxConstraints, Offset, Point, Rect, Size } from "../common/geometryPromitives.ts";
import type { KeyPressEvent } from "../input/keyEvent.ts";
import type { MouseToken } from "../input/rawTerminalToken.ts";
import { DamageList } from "../rendering/damage.ts";
import { TerminalScreen } from "../rendering/terminalScreen.ts";

import { contextMenuEventFromKeydown } from "./events/contextMenuEventSource.ts";
import { FocusManager } from "./events/focusManager.ts";
import { MouseEventDispatcher } from "./events/mouseEventDispatcher.ts";
import { TUIKeyboardEvent } from "./events/tuiKeyboardEvent.ts";
import { TUIPasteEvent } from "./events/tuiPasteEvent.ts";
import { ROOT_STYLE_CONTEXT } from "./styles/tuiStyle.ts";
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
    // Следующий кадр — полный (первый кадр, ресайз, invalidateScreen).
    private needsFullRepaint = true;

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

            // Root at (0, 0) — top-left of screen. globalPosition производный
            // (localPosition корня без родителя), выставлять его не нужно.
            this.root.localPosition = new Offset(0, 0);

            // Layout и стили — полные каждый кадр (дёшево, геометрия и
            // validateTree не зависят от damage); стили гейтятся внутри.
            const constraints = BoxConstraints.tight(this.screen.size);
            this.root.layout(constraints);
            this.root.performStyleResolution(ROOT_STYLE_CONTEXT);

            // Damage-обход — всегда: и собирает области, и актуализирует
            // lastPaintedRect/флаги (даже когда кадр будет полным).
            const damage = new DamageList();
            for (const detached of this.root.takePendingDetachDamage()) {
                damage.add(detached);
            }
            this.root.collectDamage(damage, new Point(0, 0));

            const screenBounds = new Rect(new Point(0, 0), this.screen.size);
            let rects: readonly Rect[];
            if (this.needsFullRepaint) {
                this.needsFullRepaint = false;
                this.screen.clear();
                rects = [screenBounds];
            } else {
                rects = damage.finalize(screenBounds);
            }

            // Экран — ретейн-буфер: перерисовываются только повреждённые
            // области. Инвариант: множество очищенных ячеек == множеству,
            // по которому клипуется (и прунится) проход отрисовки. Внутри
            // области канонический обход идентичен полному кадру — прозрачные
            // элементы, хром родителей и оверлеи корректны по построению.
            for (let rect of rects) {
                // Кромка области не должна рассекать wide-char пару ретейн-грида:
                // очистка лечила бы голову вне области перерисовки (см. Grid).
                rect = this.screen.snapToWideChars(rect);
                this.screen.clearRect(rect);
                // Аппаратный курсор ставится только в render его владельца:
                // позиция в повреждённой области гаснет и пере-ставится тем,
                // кто её снова нарисует (или остаётся погашенной — паритет с
                // полным кадром, где clear() гасил её всегда).
                if (this.screen.cursorPosition !== null && rect.containsPoint(this.screen.cursorPosition)) {
                    this.screen.clearCursorPosition();
                }
                this.root.render(new RenderContext(this.screen, new Offset(0, 0), rect));
            }

            // Всегда: пустой damage — пустой diff, ноль байт в терминал.
            this.screen.flush(this.backend);
            if (this.validateTreeAfterRender) {
                assertValidTree(this.root);
            }
        }
    }

    /**
     * Принудительно сделать следующий кадр полным (clear + рендер всего
     * дерева). Для потребителей, меняющих картинку мимо markDirty-контракта
     * (ресайз, тестовые харнессы).
     */
    public invalidateScreen(): void {
        this.needsFullRepaint = true;
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

            this.renderAfterInput();
        }
    }

    private handlePaste(text: string): void {
        if (this.root) {
            const event = new TUIPasteEvent(text);
            const target = this.focusManager?.activeElement ?? this.root;
            target.dispatchEvent(event);
            this.renderAfterInput();
        }
    }

    private handleMouse(token: MouseToken): void {
        if (this.root) {
            this.mouseDispatcher.handleMouseToken(token, this.root);
            this.renderAfterInput();
        }
    }

    /**
     * Синхронный кадр после события ввода — только если обработчики что-то
     * пометили грязным. Одно физическое нажатие приходит 2–3 событиями
     * (keydown + синтезированный keypress, под Kitty ещё keyup) — раньше
     * каждое рендерило полный кадр, из которых пустые давали чистый diff и
     * жгли CPU впустую. Стилевые изменения гейт проходят: markStyleDirty
     * заканчивается markDirty. Синхронность оставлена намеренно: тесты и
     * обработчики читают экран/геометрию сразу после события.
     */
    private renderAfterInput(): void {
        if (this.root?.isLayoutDirty) {
            this.renderFrame();
        }
    }

    private handleResize(size: Size): void {
        this.screen = new TerminalScreen(size);
        this.needsFullRepaint = true;
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
