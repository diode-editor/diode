import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { QuickPickItem, ValidationSeverity } from "../../../common/quickPickItem.ts";

import type { QuickInputComponent } from "./quickInputComponent.ts";
import { QuickInputComponentDIToken } from "./quickInputComponent.ts";

export const QuickInputServiceDIToken = token<QuickInputService>("QuickInputService");

/**
 * Исход валидации: голая строка — ошибка (блокирует Enter), объект несёт свою
 * строгость (предупреждение и подсказка показываются, но Enter не блокируют).
 */
export type InputValidation = string | { message: string; severity: ValidationSeverity };

/**
 * Options for a single-line text prompt, mirroring VS Code's `showInputBox`.
 */
export interface InputBoxOptions {
    /** Title drawn in the overlay's top border. */
    title?: string;
    /** Subtitle drawn under the input (dim), e.g. an instruction. */
    prompt?: string;
    /** Ghost text shown when the field is empty. */
    placeholder?: string;
    /** Initial value; the cursor is seeded at the end. */
    value?: string;
    /**
     * Поле пароля: набранное закрывается маской и не показывается ни на экране,
     * ни в инспекторе. Само значение (и то, что уезжает в `validateInput`, и то,
     * чем резолвится показ) — настоящее.
     */
    password?: boolean;
    /**
     * Валидация значения. Вернуть {@link InputValidation} — показать сообщение
     * (ошибка ещё и блокирует Enter), вернуть `null` — значение в порядке.
     *
     * Может быть асинхронной: за валидацией расширения стоит раунд-трип через
     * границу процессов. Ответы, устаревшие к моменту прихода (пользователь уже
     * дописал), сервис отбрасывает — на экране всегда сообщение о ТЕКУЩЕМ тексте.
     */
    validateInput?: (value: string) => InputValidation | null | Promise<InputValidation | null>;
}

/**
 * Options for a list pick, mirroring VS Code's `showQuickPick`.
 */
export interface QuickPickOptions {
    /** Title drawn in the overlay's top border. */
    title?: string;
    /** Ghost text shown when the query field is empty. */
    placeholder?: string;
    /** The items to choose from. Filtered live by their `label` as the user types. */
    items: readonly QuickPickItem[];
    /** Row to pre-highlight when the picker opens (clamped into range; default 0). */
    activeIndex?: number;
    /**
     * Fired as the highlighted item changes (open, arrow navigation, filtering) —
     * the hook behind live preview (e.g. applying a theme while browsing). Receives
     * `undefined` when the filtered list is empty.
     */
    onDidChangeActive?: (item: QuickPickItem | undefined, index: number) => void;
}

/** Options for a multi-select list pick (`showQuickPick` с `canPickMany`). */
export interface QuickPickManyOptions {
    /** Title drawn in the overlay's top border. */
    title?: string;
    /** Ghost text shown when the query field is empty. */
    placeholder?: string;
    /** The items to choose from. Filtered live by their `label` as the user types. */
    items: readonly QuickPickItem[];
    /** Пункты, отмеченные при открытии. Идентичность — по ссылке на предмет. */
    picked?: readonly QuickPickItem[];
}

/** Что отдаёт наружу пикер: значение InputBox, строка списка либо набор строк. */
type QuickInputResult = string | QuickPickItem | readonly QuickPickItem[] | undefined;

/** Валидация вернула промис (а не готовый исход) — ждём его. */
function isThenable(value: unknown): value is Promise<InputValidation | null> {
    return typeof (value as { then?: unknown } | null)?.then === "function";
}

/**
 * VS Code-style QuickInput service (the reusable "enter a value" / "pick from a
 * list" control).
 *
 * Виджетом и overlay-сессией владеет {@link QuickInputComponent} — общий с
 * {@link import("../../../contrib/quickaccess/browser/quickOpenService.ts").QuickOpenService}; сервис на каждый
 * показ полностью ре-инициализирует состояние и колбэки виджета. Only one
 * quick-input is ever active at a time; a new call cancels any previous one.
 *
 * Exposes the InputBox flavor (`input()`), the list-pick flavor (`quickPick()`)
 * и множественный выбор (`quickPickMany()`). The file-dialog flavor reuses the
 * same widget/session and is a future addition.
 */
export class QuickInputService {
    public static dependencies = [QuickInputComponentDIToken] as const;

    private pendingResolve: ((value: QuickInputResult) => void) | null = null;

    public constructor(private readonly component: QuickInputComponent) {}

    /**
     * Prompt the user for a single line of text. Resolves with the entered value
     * on Enter, or `undefined` if the prompt is dismissed (Escape / outside
     * click / superseded by another call).
     */
    public input(opts: InputBoxOptions = {}): Promise<string | undefined> {
        // A previous prompt still open? Cancel it before starting a new one.
        // (Включая чужой показ на общем виджете — например, открытый Quick Open.)
        this.settle(undefined);
        this.component.hide();

        return new Promise<string | undefined>((resolve) => {
            const owner: (value: QuickInputResult) => void = resolve as (value: QuickInputResult) => void;
            this.pendingResolve = owner;
            this.takeOwnership();

            const view = this.component.view;
            view.resetFlavorState();
            view.acceptMode = "value";
            view.items = [];
            view.title = opts.title;
            view.prompt = opts.prompt;
            view.placeholder = opts.placeholder ?? "";
            view.password = opts.password === true;
            view.validationSeverity = "error";
            // Clear any list-pick leftovers so a prior quickPick() can't fire here.
            view.onAccept = null;
            view.onActiveItemChanged = null;

            const validate = opts.validateInput;
            /**
             * Порядковый номер запроса валидации. Асинхронная валидация — это
             * гонка: пока расширение думает над `ab`, пользователь дописал до
             * `abcde`, и ответ про `ab` пришёл бы последним. Применяем только
             * ответ на САМЫЙ СВЕЖИЙ запрос этой сессии.
             */
            let validationSeq = 0;
            const showValidation = (outcome: InputValidation | null): void => {
                if (outcome === null) {
                    view.validationMessage = null;
                    view.validationSeverity = "error";
                } else if (typeof outcome === "string") {
                    view.validationMessage = outcome;
                    view.validationSeverity = "error";
                } else {
                    view.validationMessage = outcome.message;
                    view.validationSeverity = outcome.severity;
                }
                view.markDirty();
            };
            const runValidation = (query: string): void => {
                if (validate === undefined) {
                    showValidation(null);
                    return;
                }
                // Stryker disable next-line UpdateOperator: номер нужен только чтобы отличать запросы друг от друга — декремент даёт ровно ту же последовательность различных значений
                const seq = ++validationSeq;
                const outcome = validate(query);
                if (!isThenable(outcome)) {
                    showValidation(outcome);
                    return;
                }
                void outcome.then((result) => {
                    // Ответ устарел либо сессию уже перехватили — молча гасим:
                    // иначе под полем висело бы сообщение о чужом тексте.
                    if (seq !== validationSeq || this.pendingResolve !== owner) return;
                    showValidation(result);
                });
            };
            view.onQueryChange = runValidation;

            view.setQuery(opts.value ?? "");
            // Seed the validation state for the initial value.
            runValidation(view.getQuery());

            this.component.show();
        });
    }

    /**
     * Present a filterable list and resolve with the chosen {@link QuickPickItem}
     * on Enter, or `undefined` if dismissed (Escape / outside click / superseded).
     *
     * The list is filtered live by a case-insensitive substring match on each
     * item's `label`. `onDidChangeActive` fires whenever the highlighted item
     * changes (open, navigation, filtering) — the seam for live preview.
     */
    public quickPick(opts: QuickPickOptions): Promise<QuickPickItem | undefined> {
        // A previous pick still open? Cancel it before starting a new one.
        // (Включая чужой показ на общем виджете — например, открытый Quick Open.)
        this.settle(undefined);
        this.component.hide();

        return new Promise<QuickPickItem | undefined>((resolve) => {
            this.pendingResolve = resolve as (value: QuickInputResult) => void;
            this.takeOwnership();

            const view = this.configurePick(opts.items, {
                title: opts.title,
                placeholder: opts.placeholder,
                canPickMany: false,
                onDidChangeActive: opts.onDidChangeActive,
            });
            view.onAccept = (item) => {
                // Mirror the InputBox flavor: defer the close so the trailing key
                // event of this Enter does not land in the newly-focused editor.
                queueMicrotask(() => {
                    this.settle(item);
                });
            };

            if (opts.activeIndex !== undefined) view.setActiveIndex(opts.activeIndex);
            opts.onDidChangeActive?.(view.items[view.selectedIndex], view.selectedIndex);

            this.component.show();
        });
    }

    /**
     * Множественный выбор: у строк появляются чекбоксы, `Space` переключает
     * отметку, `Enter` принимает набор. Резолвится массивом отмеченных предметов
     * **в порядке исходного списка** (как в VS Code, а не в порядке отметки);
     * пустой массив — «ничего не отмечено», а `undefined` — отмена.
     */
    public quickPickMany(opts: QuickPickManyOptions): Promise<readonly QuickPickItem[] | undefined> {
        // Stryker disable next-line CallExpression: дублируется строкой ниже — `hide()` и так дёргает onDidClose прошлого владельца, а тот доводит его обещание до undefined; явный settle только называет намерение
        this.settle(undefined);
        this.component.hide();

        return new Promise<readonly QuickPickItem[] | undefined>((resolve) => {
            this.pendingResolve = resolve as (value: QuickInputResult) => void;
            this.takeOwnership();

            const allItems = opts.items;
            const view = this.configurePick(allItems, {
                title: opts.title,
                placeholder: opts.placeholder,
                canPickMany: true,
            });
            // Отметки ставим ПОСЛЕ заполнения списка: их рисуют сами строки.
            // Stryker disable next-line ArrayDeclaration: подмена пустого массива непустым ничего не меняет — отметки ищутся по идентичности предметов списка, и чужой объект в наборе не совпадёт ни с одним из них
            view.setCheckedItems(opts.picked ?? []);
            view.onAccept = null;
            view.onAcceptMany = () => {
                // Порядок ответа — исходного списка: фильтровать нужно allItems,
                // а не отфильтрованные `view.items`, иначе отмеченное, но
                // отсеянное текущим запросом, потерялось бы.
                const checked = view.checkedItems;
                const picked = allItems.filter((item) => checked.has(item));
                // Отложенное закрытие — как у остальных флейворов: хвост того же
                // Enter не должен долететь до получившего фокус редактора.
                queueMicrotask(() => {
                    this.settle(picked);
                });
            };

            this.component.show();
        });
    }

    /**
     * Общая часть обоих list-флейворов: состояние виджета, живая фильтрация по
     * `label` и подписка на смену подсветки. Возвращает настроенный виджет —
     * колбэк принятия каждый флейвор вешает свой.
     */
    private configurePick(
        allItems: readonly QuickPickItem[],
        opts: {
            title?: string;
            placeholder?: string;
            canPickMany: boolean;
            onDidChangeActive?: (item: QuickPickItem | undefined, index: number) => void;
        },
    ): typeof this.component.view {
        const view = this.component.view;
        // Stryker disable next-line CallExpression: страховка на общем виджете; оба list-флейвора ниже сами выставляют canPickMany, а набор отметок перетирает quickPickMany своим setCheckedItems — наблюдаемого следа от снятия сброса нет. Настоящий его потребитель — QuickOpenService, там он под тестом
        view.resetFlavorState();
        // Stryker disable next-line StringLiteral: режим читается единственным сравнением `acceptMode === "value"`, поэтому любая другая строка ведёт себя как "item"
        view.acceptMode = "item";
        view.canPickMany = opts.canPickMany;
        view.title = opts.title;
        view.prompt = undefined;
        view.placeholder = opts.placeholder ?? "";
        view.validationMessage = null;

        const notifyActive = (): void => {
            const index = view.selectedIndex;
            opts.onDidChangeActive?.(view.items[index], index);
        };

        view.onQueryChange = (query) => {
            // Stryker disable next-line MethodExpression: trim здесь косметический — набрать ведущий пробел в строке запроса нельзя (в множественном выборе его съедает отметка, а лишние пробелы внутри слова фильтр и так не сужают)
            const needle = query.trim().toLowerCase();
            // Stryker disable next-line ConditionalExpression,StringLiteral: ветка с пустым запросом — только чтобы не гонять фильтр вхолостую; `includes("")` истинно для любой строки, так что отфильтрованный список совпал бы с исходным
            view.items = needle === "" ? allItems : allItems.filter((it) => it.label.toLowerCase().includes(needle));
            // `items =` resets the highlight to the top; surface that as an active change.
            notifyActive();
        };
        view.onActiveItemChanged = () => {
            notifyActive();
        };

        view.setQuery("");
        view.items = allItems;
        return view;
    }

    /**
     * Снять текущий показ извне (токен отмены расширения, смерть его процесса):
     * промис владельца доводится до `undefined`, оверлей закрывается. Ничего не
     * открыто — no-op.
     */
    public cancel(): void {
        this.settle(undefined);
    }

    /**
     * Перехват общего виджета этим сервисом: колбэки отмены/принятия значения и
     * канал закрытия сессии перенастраиваются на текущий промис (Quick Open при
     * своём открытии выставляет их обратно на себя).
     */
    private takeOwnership(): void {
        const view = this.component.view;
        view.onCancel = () => {
            this.settle(undefined);
        };
        view.onAcceptValue = (value) => {
            // The widget already blocks Enter on a hard validation error.
            // Defer to a microtask (like QuickOpenService): closing the session here
            // restores focus to the editor, and doing that synchronously mid-keypress would
            // let the trailing key event of the same Enter land in the now-focused editor.
            queueMicrotask(() => {
                this.settle(value);
            });
        };
        this.component.onDidClose = () => {
            // Outside click / Escape / programmatic close all resolve as cancelled.
            this.settle(undefined);
        };
    }

    /** Resolve the pending promise exactly once and close the overlay. */
    private settle(value: QuickInputResult): void {
        const resolve = this.pendingResolve;
        if (resolve === null) return;
        this.pendingResolve = null;
        this.component.hide();
        resolve(value);
    }
}
