import { Disposable, type IDisposable } from "@tuidom/core/common/disposable";
import { Point } from "@tuidom/core/common/geometryPromitives";
import type { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { OverlaySessionHandle } from "@tuidom/core/dom/overlayLayer";
import type { BodyElement } from "@tuidom/elements/body/bodyElement";
import { BoxContainerElement } from "@tuidom/elements/layout/boxContainerElement";
import { FitContentElement } from "@tuidom/elements/layout/fitContentElement";
import { PaddingContainerElement } from "@tuidom/elements/layout/paddingContainerElement";
import { VStackElement } from "@tuidom/elements/layout/vStackElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { Keybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { DIALOG_STYLES } from "../../../browser/parts/dialogs/dialogComponent.ts";
import {
    describeBindings,
    describeEnv,
    describeEvent,
    describeVerdict,
    type DoctorStep,
    doctorSteps,
    formatReport,
    judge,
    type KeyboardDoctorEnv,
    type MatchedBinding,
    type ObservedKey,
    type StepResult,
} from "../common/keyboardDoctorModel.ts";

export const KeyboardDoctorComponentDIToken = token<KeyboardDoctorComponent>("KeyboardDoctorComponent");

/**
 * Узкий срез окружения для доктора. Сам TerminalEnvironmentService живёт в
 * node-окружении — биндинг делает DI-модуль (diode-слой), browser-компонент
 * node не импортирует.
 */
export interface IKeyboardDoctorEnvProvider {
    snapshot(): KeyboardDoctorEnv;
    onDidChange(listener: () => void): IDisposable;
}

/** Какие бинды есть у комбинации и действуют ли они в этом окружении. */
export type BindingLookup = (part: Keybinding, env: KeyboardDoctorEnv) => readonly MatchedBinding[];

// Модификаторы приходят отдельными keydown (Kitty protocol) — это не шаг проверки.
const MODIFIER_KEY_NAMES = new Set(["Control", "Shift", "Alt", "Meta", "Hyper", "Super", "AltGraph", "CapsLock"]);

const HINT = "Escape — ничего не произошло (тоже ответ)";
const KEYUP_HINT = "Enter — keyup так и не пришёл";

function observed(event: TUIKeyboardEvent): ObservedKey {
    return {
        raw: event.raw,
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
    };
}

/**
 * Keyboard Doctor: модальный оверлей, который ведёт по проверкам протокола
 * фидбека и по каждому нажатию записывает цепочку «байты → токены → событие →
 * сматченный бинд» с вердиктом. Резолвится текстом отчёта — телом фидбека.
 *
 * Захват — как у рекордера комбинаций: сфокусированный корень со
 * `stopPropagation` на target-фазе отсекает KeybindingDispatcher, так что
 * проверяемая комбинация ничего не исполняет. Capture-хендлер диспатчера на
 * корне всё равно видит нажатие первым — и Cmd, увиденный доктором, поднимает
 * рунг так же, как в работе.
 *
 * Шаг закрывается ПАРНЫМ keypress (keypress пиннится к цели keydown, см.
 * рекордер); шаг с keyup — отпусканием модификатора или голым Enter.
 */
export class KeyboardDoctorComponent extends Disposable {
    private host: BodyElement | null = null;
    private session: OverlaySessionHandle | null = null;

    private readonly root: FitContentElement;
    private readonly envLabels = [new TextLabelElement(""), new TextLabelElement(""), new TextLabelElement("")];
    private readonly stepLabel = new TextLabelElement("");
    private readonly catchesLabel = new TextLabelElement("");
    private readonly lastLabel = new TextLabelElement("");
    private readonly hintLabel = new TextLabelElement(HINT);

    private steps: DoctorStep[] = [];
    private results: StepResult[] = [];
    /** Нажатие шага с keyup записано; ждём отпускания модификатора (или голый Enter). */
    private awaitingKeyUp: { received: ObservedKey; bindings: readonly MatchedBinding[] } | null = null;
    /** Шаг записан; переходим дальше на парном keypress. */
    private advanceOnKeyPress = false;
    private resolveRun: ((report: string) => void) | null = null;
    private envSubscription: IDisposable | null = null;

    public constructor(
        private readonly env: IKeyboardDoctorEnvProvider,
        private readonly lookup: BindingLookup,
    ) {
        super();
        this.root = new FitContentElement();
        this.root.id = "keyboardDoctor";
        this.root.focusable = true;

        const stack = new VStackElement();
        for (const label of [...this.envLabels, this.stepLabel, this.catchesLabel, this.lastLabel, this.hintLabel]) {
            stack.addChild(label, { width: "stretch", height: 1 });
        }
        // Stryker disable next-line CallExpression: чисто цветовая настройка — палитра не проверяется покадрово.
        this.hintLabel.setColors(DIALOG_STYLES.descriptionFg, DIALOG_STYLES.bg);
        // Stryker disable next-line CallExpression: чисто цветовая настройка — палитра не проверяется покадрово.
        this.catchesLabel.setColors(DIALOG_STYLES.descriptionFg, DIALOG_STYLES.bg);

        const box = new BoxContainerElement();
        // Stryker disable next-line CallExpression: фон рамки — цвет, не поведение.
        box.setBg(DIALOG_STYLES.bg);
        // Stryker disable next-line CallExpression: цвет рамки — не поведение.
        box.setBorderFg(DIALOG_STYLES.borderFg);
        box.setTitle("Keyboard Doctor");
        // Stryker disable next-line CallExpression: цвет заголовка — не поведение.
        box.setTitleFg(DIALOG_STYLES.fg);
        // Stryker disable next-line ObjectLiteral: отступы окна — косметика раскладки.
        const padding = new PaddingContainerElement(stack, { left: 2, right: 2 });
        // Stryker disable next-line ObjectLiteral: цвета контейнера — не поведение.
        padding.style = { fg: DIALOG_STYLES.fg, bg: DIALOG_STYLES.bg };
        box.setChild(padding);
        this.root.setChild(box);

        this.root.addEventListener("keydown", (event) => {
            this.handleKeyDown(event);
        });
        this.root.addEventListener("keypress", (event) => {
            // Ни один keypress не должен протечь за оверлей (в редактор позади).
            // Stryker disable next-line CallExpression: анти-утечка keypress; ненаблюдаема без фонового потребителя за оверлеем.
            event.preventDefault();
            // Stryker disable next-line CallExpression: анти-утечка keypress; ненаблюдаема без фонового потребителя за оверлеем.
            event.stopPropagation();
            if (this.advanceOnKeyPress) this.advance();
        });
        this.root.addEventListener("keyup", (event) => {
            // Stryker disable next-line CallExpression: keyup-хендлер диспатчера (hold-сессии) на корне — отсекаем, как и keydown.
            event.stopPropagation();
            const pending = this.awaitingKeyUp;
            if (pending === null || this.steps[this.results.length].keyUp !== event.key) return;
            this.awaitingKeyUp = null;
            this.record(pending.received, pending.bindings, true);
            this.advance();
        });

        this.register({
            dispose: () => {
                this.envSubscription?.dispose();
                this.session?.dispose();
            },
        });
    }

    /** Вызывается владельцем корневой view до первого запуска (конвенция DialogService). */
    public attachHost(host: BodyElement): void {
        this.host = host;
    }

    /** Открыт ли доктор (для тестов/оркестрации). */
    public isOpen(): boolean {
        return this.session?.isOpen() ?? false;
    }

    /**
     * Проводит человека по проверкам и резолвится текстом отчёта (тело
     * фидбека). Повторный вызов при открытом докторе начинает заново.
     */
    public run(): Promise<string> {
        if (this.host === null) {
            throw new Error("KeyboardDoctorComponent: host is not attached (attachHost must be called first)");
        }
        this.steps = doctorSteps(this.env.snapshot());
        this.results = [];
        this.awaitingKeyUp = null;
        this.advanceOnKeyPress = false;
        this.envSubscription?.dispose();
        this.envSubscription = this.env.onDidChange(() => {
            this.render();
        });
        this.render();

        const session = (this.session ??= this.host.overlayLayer.createSession(this.root, new Point(0, 0), {
            // Stryker disable next-line BooleanLiteral: стартовая невидимость сразу перекрывается open() в openCentered().
            visible: false,
            restoreFocus: true,
            // Escape — ответ «ничего не произошло», слой закрывать сессию не должен.
            // Stryker disable next-line BooleanLiteral: handleKeyDown глушит Escape stopPropagation'ом раньше слоя — значение флага ненаблюдаемо.
            closeOnEscape: false,
            // Stryker disable next-line StringLiteral: pointer-политика не проверяется в клавиатурных тестах.
            pointerPolicy: "modal",
        }));
        this.openCentered(this.host, session);
        this.root.focus();

        return new Promise((resolve) => {
            this.resolveRun = resolve;
        });
    }

    private handleKeyDown(event: TUIKeyboardEvent): void {
        // Stryker disable next-line CallExpression: подавление дефолта; в изоляции ненаблюдаемо.
        event.preventDefault();
        // Stryker disable next-line CallExpression: отсекает KeybindingDispatcher (bubble); в юните без диспатчера ненаблюдаемо.
        event.stopPropagation();
        if (MODIFIER_KEY_NAMES.has(event.key) || this.advanceOnKeyPress) return;
        const bare = !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey;

        const pending = this.awaitingKeyUp;
        if (pending !== null) {
            // Ждём отпускания модификатора; голый Enter — «keyup не пришёл».
            if (bare && event.key === "Enter") {
                this.awaitingKeyUp = null;
                this.record(pending.received, pending.bindings, false);
                this.advanceOnKeyPress = true;
            }
            return;
        }

        if (bare && event.key === "Escape") {
            this.record(null, [], false);
            this.advanceOnKeyPress = true;
            return;
        }
        const received = observed(event);
        const bindings = this.lookup(received, this.env.snapshot());
        if (this.steps[this.results.length].keyUp !== undefined) {
            this.awaitingKeyUp = { received, bindings };
            this.render();
            return;
        }
        this.record(received, bindings, false);
        this.advanceOnKeyPress = true;
    }

    /** Фиксирует результат текущего шага. */
    private record(received: ObservedKey | null, bindings: readonly MatchedBinding[], keyUpSeen: boolean): void {
        this.results.push({ step: this.steps[this.results.length], received, bindings, keyUpSeen });
    }

    private advance(): void {
        this.advanceOnKeyPress = false;
        if (this.results.length < this.steps.length) {
            this.render();
            return;
        }
        const resolve = this.resolveRun;
        this.resolveRun = null;
        this.envSubscription?.dispose();
        this.envSubscription = null;
        this.session?.close();
        resolve?.(formatReport(this.env.snapshot(), this.results));
    }

    private render(): void {
        const env = this.env.snapshot();
        describeEnv(env).forEach((line, i) => {
            this.envLabels[i].setText(line);
        });
        // render зовётся только пока шаги не кончились: advance после последнего закрывает доктор.
        const current = this.steps[this.results.length];
        this.stepLabel.setText(
            `Шаг ${String(this.results.length + 1)}/${String(this.steps.length)}: нажми ${current.prompt}`,
        );
        this.catchesLabel.setText(`Ловим: ${current.catches}`);
        this.lastLabel.setText(this.lastText(env));
        this.hintLabel.setText(this.awaitingKeyUp === null ? HINT : KEYUP_HINT);
        if (this.host !== null && this.session?.isOpen() === true) this.openCentered(this.host, this.session);
    }

    private lastText(env: KeyboardDoctorEnv): string {
        if (this.awaitingKeyUp !== null) {
            return `Пришло: ${describeEvent(this.awaitingKeyUp.received)} — теперь отпусти модификатор`;
        }
        const last = this.results.at(-1);
        if (last === undefined) return "";
        const arrived = last.received === null ? "ничего" : describeEvent(last.received);
        return `Было: ${arrived} · бинд: ${describeBindings(last.bindings)} · ${describeVerdict(judge(last, env))}`;
    }

    /** Центрирует окно по экрану хоста и открывает сессию (приём DialogService). */
    private openCentered(host: BodyElement, session: OverlaySessionHandle): void {
        const width = Math.min(this.root.getMaxIntrinsicWidth(0), host.layoutSize.width);
        const height = this.root.getMaxIntrinsicHeight(width);
        // Stryker disable next-line MethodExpression: центрирование по X — косметика позиции, покадрово не проверяется.
        const px = Math.max(0, Math.floor((host.layoutSize.width - width) / 2));
        // Stryker disable next-line MethodExpression,ArithmeticOperator: центрирование по Y — косметика позиции, покадрово не проверяется.
        const py = Math.max(0, Math.floor((host.layoutSize.height - height) / 2));
        // Stryker disable next-line CallExpression: setPosition — только позиция оверлея; open() определяет наблюдаемое (isOpen).
        session.setPosition(new Point(px, py));
        session.open();
    }
}
