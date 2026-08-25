import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { BoxConstraints } from "@tuidom/core/common/geometryPromitives";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ProgressService } from "../../../../platform/progress/common/progressService.ts";
import type { IStateDescriptor, IStateService } from "../../../../platform/state/common/iStateService.ts";
import { SCM_INPUT_MESSAGE_STATE } from "../../../common/stateKeys.ts";
import { SCM_CHANGES_VIEW_ID } from "../common/scmViews.ts";

import { PUBLISH_CHANGES_COMMAND, ScmChangesService } from "./changesService.ts";
import { PUBLISH_REPO_STATE_COMMAND, ScmRepoStateService } from "./repoStateService.ts";
import {
    computeActionButton,
    SCM_INPUT_HEIGHT,
    ScmCommitInputElement,
    ScmInputComponent,
} from "./scmInputComponent.ts";

function fakeState(): { service: IStateService; stored: Map<string, unknown> } {
    const stored = new Map<string, unknown>();
    const service: IStateService = {
        get<T>(descriptor: IStateDescriptor<T>): T {
            return stored.has(descriptor.key) ? (stored.get(descriptor.key) as T) : descriptor.default;
        },
        store<T>(descriptor: IStateDescriptor<T>, value: T): void {
            stored.set(descriptor.key, value);
        },
        openWorkspace: () => {},
        flushSync: () => {},
    };
    return { service, stored };
}

const REPO_STATE = {
    branch: "main",
    detached: false,
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    remotes: ["origin"],
    state: "idle",
};

interface IHarness {
    component: ScmInputComponent;
    commands: CommandRegistry;
    executed: string[];
    stored: Map<string, unknown>;
    progress: ProgressService;
    publishChanges(count: number): void;
    publishRepoState(overrides?: Partial<typeof REPO_STATE>): void;
}

function make(): IHarness {
    const commands = new CommandRegistry();
    const { service, stored } = fakeState();
    const changes = new ScmChangesService(commands);
    const repoState = new ScmRepoStateService(commands, new ContextKeyService());
    const progress = new ProgressService();
    const component = new ScmInputComponent(service, changes, repoState, commands, progress);

    const executed: string[] = [];
    for (const id of ["git.commit", "git.publish", "git.sync"]) {
        commands.register(id, () => executed.push(id));
    }
    return {
        component,
        commands,
        executed,
        stored,
        progress,
        publishChanges: (count) => {
            commands.execute(
                PUBLISH_CHANGES_COMMAND,
                Array.from({ length: count }, (_, i) => ({
                    uri: `file:///repo/f${String(i)}.ts`,
                    status: "M",
                    colorId: "gitDecoration.modifiedResourceForeground",
                    path: `f${String(i)}.ts`,
                    group: "worktree",
                })),
            );
        },
        publishRepoState: (overrides = {}) => {
            commands.execute(PUBLISH_REPO_STATE_COMMAND, { ...REPO_STATE, ...overrides });
        },
    };
}

describe("computeActionButton (правила VS Code)", () => {
    const repo = { hasRepository: true, branch: "main", upstream: "origin/main", ahead: 0, behind: 0 };

    it("вне репозитория — скрыта; изменения есть — Commit", () => {
        expect(computeActionButton(true, { ...repo, hasRepository: false }).visible).toBe(false);
        expect(computeActionButton(true, repo)).toEqual({ visible: true, label: "Commit", command: "git.commit" });
    });

    it("чисто: без upstream — Publish Branch; с расхождением — Sync; синхронно — disabled Commit", () => {
        expect(computeActionButton(false, { ...repo, upstream: null })).toEqual({
            visible: true,
            label: "Publish Branch",
            command: "git.publish",
        });
        expect(computeActionButton(false, { ...repo, ahead: 2, behind: 1 })).toEqual({
            visible: true,
            label: "Sync Changes ↓1 ↑2",
            command: "git.sync",
        });
        expect(computeActionButton(false, repo)).toEqual({ visible: true, label: "Commit", command: null });
    });

    it("detached без upstream — не Publish (ветки нет), а disabled Commit", () => {
        expect(computeActionButton(false, { ...repo, branch: null, upstream: null })).toEqual({
            visible: true,
            label: "Commit",
            command: null,
        });
    });
});

describe("ScmInputComponent — поле", () => {
    it("безрамочное поле с плейсхолдером и id для e2e; обвязка — sideBar-фон", () => {
        const h = make();
        expect(h.component.input).toBeInstanceOf(ScmCommitInputElement);
        expect(h.component.input.id).toBe("scmCommitInput");
        expect(h.component.input.showBorder).toBe(false);
        expect(h.component.input.placeholder).toContain("Ctrl+Enter to commit");
        expect(h.component.view.id).toBe("scmInputBox");
        expect(h.component.view.style.bg).toBe("sideBar.background");
    });

    it("между полем и кнопкой — пустая строка, весь блок укладывается в SCM_INPUT_HEIGHT", () => {
        const h = make();
        h.publishRepoState();
        renderElement(h.component.view, 20, SCM_INPUT_HEIGHT, { themeVars: true });

        const inputY = h.component.input.globalPosition.y;
        const buttonY = h.component.actionButton.globalPosition.y;
        // Ровно одна свободная строка между ними (обе высотой 1).
        expect(buttonY - inputY).toBe(2);
        expect(h.component.view.layoutSize.height).toBe(SCM_INPUT_HEIGHT);
    });

    it("поле начинается с первой строки блока — сверху padding'а нет", () => {
        const h = make();
        h.publishRepoState();
        // Ширина с запасом: боковые padding'и съедают две колонки, и на 30
        // плейсхолдер обрезается.
        const screen = renderElement(h.component.view, 40, SCM_INPUT_HEIGHT, { themeVars: true });

        // Ассерт на абсолютную позицию, а не на разницу с кнопкой: относительные
        // смещения переживают лишний отступ сверху, ради снятия которого правка
        // и делалась.
        expect(h.component.input.globalPosition.y).toBe(0);
        expect(screen.screenToString().split("\n")[0]).toContain("Message (Ctrl+Enter to commit)");

        // Боковые отступы при этом на месте. Без этой пары одной проверки `y === 0`
        // мало: она проходит и когда padding'ов не осталось вовсе.
        expect(h.component.input.globalPosition.x).toBe(1);
        expect(h.component.input.layoutSize.width).toBe(40 - 2);
    });

    it("ввод пишет черновик write-through, setMessage заменяет значение и персистит", () => {
        const h = make();
        h.component.input.inputState.insert("fix: typo");
        h.component.input.onChange?.(h.component.input.inputState.value);
        expect(h.component.message).toBe("fix: typo");
        expect(h.stored.get(SCM_INPUT_MESSAGE_STATE.key)).toBe("fix: typo");

        h.component.setMessage("");
        expect(h.component.message).toBe("");
        expect(h.stored.get(SCM_INPUT_MESSAGE_STATE.key)).toBe("");
    });

    it("focus() делегирует полю ввода", () => {
        const h = make();
        const focus = vi.spyOn(h.component.input, "focus").mockImplementation(() => {});
        h.component.focus();
        expect(focus).toHaveBeenCalledTimes(1);
    });

    it("restoreDraft читает workspace-стор без write-through; совпадение — no-op", () => {
        const { service, stored } = fakeState();
        stored.set(SCM_INPUT_MESSAGE_STATE.key, "draft message");
        const commands = new CommandRegistry();
        const component = new ScmInputComponent(
            service,
            new ScmChangesService(commands),
            new ScmRepoStateService(commands, new ContextKeyService()),
            commands,
            new ProgressService(),
        );
        expect(component.message).toBe("");

        const writes = vi.spyOn(service, "store");
        component.restoreDraft();
        expect(component.message).toBe("draft message");
        expect(writes).not.toHaveBeenCalled();

        component.restoreDraft(); // повтор — no-op
        expect(component.message).toBe("draft message");
    });
});

describe("ScmInputComponent — кнопка действия", () => {
    it("скрыта до публикации repo-state; с изменениями — Commit, клик исполняет git.commit", () => {
        const h = make();
        expect(h.component.actionButton.hidden).toBe(true);

        h.publishRepoState();
        h.publishChanges(2);
        expect(h.component.actionButton.hidden).toBe(false);
        expect(h.component.actionButton.getLabel()).toBe("Commit");
        expect(h.component.actionButton.isDisabled()).toBe(false);

        h.component.actionButton.onActivate?.();
        expect(h.executed).toEqual(["git.commit"]);
    });

    it("чисто и без upstream — Publish Branch; с расхождением — Sync Changes с счётчиками", () => {
        const h = make();
        h.publishRepoState({ upstream: null });
        expect(h.component.actionButton.getLabel()).toBe("Publish Branch");
        h.component.actionButton.onActivate?.();
        expect(h.executed).toEqual(["git.publish"]);

        h.executed.length = 0;
        h.publishRepoState({ ahead: 3, behind: 1 });
        expect(h.component.actionButton.getLabel()).toBe("Sync Changes ↓1 ↑3");
        h.component.actionButton.onActivate?.();
        expect(h.executed).toEqual(["git.sync"]);
    });

    it("чисто и синхронно — Commit задизейблен: не активируется ни кликом, ни Enter", () => {
        const h = make();
        h.publishRepoState();
        expect(h.component.actionButton.getLabel()).toBe("Commit");
        expect(h.component.actionButton.isDisabled()).toBe(true);
        expect(h.component.actionButton.focusable).toBe(false);

        h.component.actionButton.onActivate?.(); // команда null — no-op
        h.component.actionButton.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));
        expect(h.executed).toEqual([]);
    });

    it("переходы: Commit → (после коммита) Sync → (после sync) disabled Commit", () => {
        const h = make();
        h.publishRepoState();
        h.publishChanges(1);
        expect(h.component.actionButton.getLabel()).toBe("Commit");

        // Коммит: изменения ушли, ahead вырос.
        h.publishChanges(0);
        h.publishRepoState({ ahead: 1 });
        expect(h.component.actionButton.getLabel()).toBe("Sync Changes ↓0 ↑1");

        // Sync: расхождение схлопнулось.
        h.publishRepoState({ ahead: 0 });
        expect(h.component.actionButton.getLabel()).toBe("Commit");
        expect(h.component.actionButton.isDisabled()).toBe(true);
    });

    it("рендер: label по центру на всю ширину; header рендерится с полем и кнопкой", () => {
        const h = make();
        h.publishRepoState();
        h.publishChanges(1);
        const screen = renderElement(h.component.view, 30, SCM_INPUT_HEIGHT, { themeVars: true }).screenToString();
        expect(screen).toContain("Message (Ctrl+Enter to comm"); // безрамочный input, клип по ширине
        const buttonLine = screen.split("\n").find((l) => l.includes("Commit"))!;
        // Центрирование: слева и справа от label есть отступ кнопки.
        expect(buttonLine.indexOf("Commit")).toBeGreaterThan(3);

        // Disabled-вид рендерится secondary-цветами без падений.
        h.publishChanges(0);
        expect(h.component.actionButton.isDisabled()).toBe(true);
        expect(renderElement(h.component.view, 30, SCM_INPUT_HEIGHT, { themeVars: true }).screenToString()).toContain("Commit");
    });

    it("клик мышью активирует включённую кнопку и игнорирует задизейбленную", () => {
        const h = make();
        h.publishRepoState();
        h.publishChanges(1);
        const click = () =>
            h.component.actionButton.dispatchEvent(
                new TUIMouseEvent("click", { button: "left", screenX: 1, screenY: 0, localX: 1, localY: 0 }),
            );
        click();
        expect(h.executed).toEqual(["git.commit"]);

        h.executed.length = 0;
        h.publishChanges(0); // синхронно и чисто → disabled
        click();
        h.component.actionButton.dispatchEvent(new TUIKeyboardEvent("keydown", { key: " " }));
        expect(h.executed).toEqual([]);

        // Space активирует включённую (вторая клавиша performDefaultAction).
        h.publishChanges(1);
        h.component.actionButton.dispatchEvent(new TUIKeyboardEvent("keydown", { key: " " }));
        expect(h.executed).toEqual(["git.commit"]);
    });

    it("метрики: высота всегда 1; без ограничения ширины layout падает на minWidth", () => {
        const h = make();
        expect(h.component.actionButton.getMinIntrinsicHeight(10)).toBe(1);
        expect(h.component.actionButton.getMaxIntrinsicHeight(10)).toBe(1);
        const size = h.component.actionButton.layout(
            new BoxConstraints(12, Number.POSITIVE_INFINITY, 0, Number.POSITIVE_INFINITY),
        );
        expect(size.width).toBe(12);
        expect(size.height).toBe(1);
    });

    it("inspectState кнопки отдаёт label/disabled/hidden; Enter активирует включённую", () => {
        const h = make();
        h.publishRepoState();
        h.publishChanges(1);
        expect(h.component.actionButton.inspectState()).toEqual({
            label: "Commit",
            disabled: false,
            hidden: false,
        });

        h.component.actionButton.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));
        expect(h.executed).toEqual(["git.commit"]);
    });
});

describe("ScmInputComponent — кнопка во время операции", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("гаснет сразу, а спиннер в подписи появляется только у долгой операции", async () => {
        const h = make();
        h.publishRepoState();
        h.publishChanges(1);
        expect(h.component.actionButton.inspectState()).toMatchObject({ label: "Commit", disabled: false });

        let done!: () => void;
        const running = h.progress.withProgress(
            { location: "view", viewId: SCM_CHANGES_VIEW_ID, title: "Committing…" },
            () =>
                new Promise<void>((resolve) => {
                    done = resolve;
                }),
        );

        // Клик перестал работать мгновенно, подпись ещё прежняя.
        expect(h.component.actionButton.inspectState()).toMatchObject({ label: "Commit", disabled: true });

        vi.advanceTimersByTime(300);
        expect(h.component.actionButton.inspectState()).toMatchObject({
            label: "⠋ Committing…",
            disabled: true,
        });

        done();
        await running;
        vi.advanceTimersByTime(500);
        expect(h.component.actionButton.inspectState()).toMatchObject({ label: "Commit", disabled: false });
    });

    it("операция чужой секции кнопку не трогает", () => {
        const h = make();
        h.publishRepoState();
        h.publishChanges(1);

        void h.progress.withProgress({ location: "view", viewId: "workbench.scm.graph", title: "Loading History…" }, () =>
            new Promise<void>(() => {}),
        );
        vi.advanceTimersByTime(1000);
        expect(h.component.actionButton.inspectState()).toMatchObject({ label: "Commit", disabled: false });
    });
});
