import { LatestRequest } from "../../../../base/common/cancellation.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { QuickPickItem, ValidationSeverity } from "../../../common/quickPickItem.ts";

import type { QuickInputComponent } from "./quickInputComponent.ts";
import { QuickInputComponentDIToken } from "./quickInputComponent.ts";
import {
    type IQuickInputSlot,
    QuickPickSession,
    type QuickPickSessionEvents,
    type QuickPickSessionItem,
} from "./quickPickSession.ts";

export const QuickInputServiceDIToken = token<QuickInputService>("QuickInputService");

/** Голая строка — ошибка (блокирует Enter); объект со своей строгостью Enter не блокирует. */
export type InputValidation = string | { message: string; severity: ValidationSeverity };

export interface InputBoxOptions {
    title?: string;
    prompt?: string;
    placeholder?: string;
    /** Курсор ставится в конец. */
    value?: string;
    /** Маска только на экране и в инспекторе; `validateInput` и результат получают настоящее значение. */
    password?: boolean;
    /** Ответы, устаревшие к моменту прихода, отбрасываются — на экране сообщение о текущем тексте. */
    validateInput?: (value: string) => InputValidation | null | Promise<InputValidation | null>;
}

export interface QuickPickOptions {
    title?: string;
    placeholder?: string;
    items: readonly QuickPickItem[];
    /** Клампится в границы; по умолчанию 0. */
    activeIndex?: number;
    /** Файрится и на открытии и фильтрации, не только на навигации; `undefined` — список пуст. */
    onDidChangeActive?: (item: QuickPickItem | undefined, index: number) => void;
}

/** Options for a multi-select list pick (`showQuickPick` с `canPickMany`). */
export interface QuickPickManyOptions {
    title?: string;
    placeholder?: string;
    items: readonly QuickPickItem[];
    /** Идентичность — по ссылке на предмет. */
    picked?: readonly QuickPickItem[];
}

type QuickInputResult = string | QuickPickItem | readonly QuickPickItem[] | undefined;

function isThenable(value: unknown): value is Promise<InputValidation | null> {
    return typeof (value as { then?: unknown } | null)?.then === "function";
}

/**
 * Виджетом и overlay-сессией владеет {@link QuickInputComponent}, общий с
 * QuickOpenService: на каждый показ состояние и колбэки виджета ре-инициализируются,
 * новый показ отменяет предыдущий.
 */
export class QuickInputService {
    public static dependencies = [QuickInputComponentDIToken] as const;

    private pendingResolve: ((value: QuickInputResult) => void) | null = null;

    public constructor(private readonly component: QuickInputComponent) {}

    /** `undefined` — отмена: Escape, клик мимо, перехват другим показом. */
    public input(opts: InputBoxOptions = {}): Promise<string | undefined> {
        // Включая чужой показ на общем виджете — например, открытый Quick Open.
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
            // Иначе accept прошлого quickPick() сработал бы здесь.
            view.onAccept = null;
            view.onActiveItemChanged = null;

            const validate = opts.validateInput;
            // Асинхронная валидация — гонка: ответ про `ab` может прийти после `abcde`.
            const validation = new LatestRequest();
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
                const ticket = validation.start();
                const outcome = validate(query);
                if (!isThenable(outcome)) {
                    showValidation(outcome);
                    return;
                }
                void outcome.then((result) => {
                    if (ticket.isStale() || this.pendingResolve !== owner) return;
                    showValidation(result);
                });
            };
            view.onQueryChange = runValidation;

            view.setQuery(opts.value ?? "");
            runValidation(view.getQuery());

            this.component.show();
        });
    }

    public quickPick(opts: QuickPickOptions): Promise<QuickPickItem | undefined> {
        // Включая чужой показ на общем виджете — например, открытый Quick Open.
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
                // Отложенное закрытие: хвост этого Enter не должен долететь до редактора, получившего фокус.
                queueMicrotask(() => {
                    this.settle(item);
                });
            };

            if (opts.activeIndex !== undefined) view.setActiveIndex(opts.activeIndex);
            opts.onDidChangeActive?.(view.items[view.selectedIndex], view.selectedIndex);

            this.component.show();
        });
    }

    /** Резолвится в порядке исходного списка, как в VS Code; `[]` — ничего не отмечено, `undefined` — отмена. */
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
            // Отметки — ПОСЛЕ заполнения списка: их рисуют сами строки.
            // Stryker disable next-line ArrayDeclaration: подмена пустого массива непустым ничего не меняет — отметки ищутся по идентичности предметов списка, и чужой объект в наборе не совпадёт ни с одним из них
            view.setCheckedItems(opts.picked ?? []);
            view.onAccept = null;
            view.onAcceptMany = () => {
                // Фильтруем allItems, а не `view.items`: иначе отмеченное, но отсеянное запросом, потерялось бы.
                const checked = view.checkedItems;
                const picked = allItems.filter((item) => checked.has(item));
                queueMicrotask(() => {
                    this.settle(picked);
                });
            };

            this.component.show();
        });
    }

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
            notifyActive();
        };
        view.onActiveItemChanged = () => {
            notifyActive();
        };

        view.setQuery("");
        view.items = allItems;
        return view;
    }

    /** `createQuickPick` эталона: закрывается только владельцем, Escape-ом или перехватом виджета. */
    public createQuickPick<T extends QuickPickSessionItem>(events: QuickPickSessionEvents<T>): QuickPickSession<T> {
        return new QuickPickSession<T>(this.slot, events);
    }

    /** Владелец показа — `pendingResolve`, как у промисных флейворов: перехват (`settle`) доводит до него потерю. */
    private readonly slot: IQuickInputSlot = {
        claim: (onLost) => {
            // Stryker disable next-line CallExpression: дублируется строкой ниже — `hide()` и так дёргает onDidClose прошлого владельца, а тот доводит его показ до конца сам; явный settle только называет намерение (как в quickPickMany)
            this.settle(undefined);
            this.component.hide();
            this.pendingResolve = onLost;
            this.takeOwnership();
            return this.component.view;
        },
        open: () => {
            this.component.show();
        },
        release: () => {
            this.settle(undefined);
        },
    };

    public cancel(): void {
        this.settle(undefined);
    }

    /** Quick Open при своём открытии перенастраивает колбэки виджета обратно на себя. */
    private takeOwnership(): void {
        const view = this.component.view;
        view.onCancel = () => {
            this.settle(undefined);
        };
        view.onAcceptValue = (value) => {
            // Отложенное закрытие (как в QuickOpenService): синхронный возврат фокуса посреди
            // нажатия отдал бы хвост того же Enter редактору.
            queueMicrotask(() => {
                this.settle(value);
            });
        };
        this.component.onDidClose = () => {
            this.settle(undefined);
        };
    }

    private settle(value: QuickInputResult): void {
        const resolve = this.pendingResolve;
        if (resolve === null) return;
        this.pendingResolve = null;
        this.component.hide();
        resolve(value);
    }
}
