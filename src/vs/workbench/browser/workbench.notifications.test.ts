import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import {
    NOTIFICATION_AUTO_HIDE_MS,
    type NotificationService,
    NotificationServiceDIToken,
} from "../services/notification/browser/notificationService.ts";

import {
    MAX_VISIBLE_TOASTS,
    NotificationsComponentDIToken,
    TOAST_WIDTH,
} from "./parts/notifications/notificationsComponent.ts";

/**
 * Поверхность сообщений целиком: сервис → overlay-слой → КАДР. Юнит-тесты
 * виджетов рядом с ними; здесь проверяется то, что видит человек — тост стоит в
 * правом нижнем углу над статус-баром, вопрос отвечается с клавиатуры, а
 * набранный текст в редакторе тостом не перехватывается.
 */
describe("Workbench — сообщения на кадре", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let notifications: NotificationService;

    beforeEach(async () => {
        ws = createTempWorkspace({ prefix: "diode-notify-", files: { "alpha.txt": "Alpha content" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir, openFile: `${ws.dir}/alpha.txt`, focusEditor: true });
        await h.workbench.activate();
        await h.workbench.fileIndexReady;
        notifications = h.container.get(NotificationServiceDIToken);
        h.testApp.render();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    function screen(): string {
        h.testApp.render();
        return h.testApp.backend.screenToString();
    }

    it("сообщение без кнопок видно на кадре", () => {
        notifications.show({ severity: "info", message: "Ruff: formatted 3 files", modal: false, items: [] });
        const text = screen();

        expect(text).toContain("Ruff: formatted 3 files");
        expect(text).toContain("Information");
    });

    it("тост стоит в правом нижнем углу НАД статус-баром", () => {
        notifications.show({ severity: "error", message: "boom", modal: false, items: [] });
        const rows = screen().split("\n");
        const { width, height } = h.testApp.root.layoutSize;

        const boxRows = rows.map((row, y) => ({ y, x: row.indexOf("╭") })).filter((r) => r.x >= 0);
        expect(boxRows).toHaveLength(1);
        // Правый край рамки — у правого края экрана (отступ в одну колонку).
        expect(boxRows[0].x).toBe(width - 1 - TOAST_WIDTH);
        // Нижняя граница — на ряду прямо над статус-баром (он занимает один ряд).
        const bottomRow = rows.findIndex((row) => row.includes("╰"));
        expect(bottomRow).toBe(height - 2);
    });

    it("несколько сообщений становятся стеком; лишние — счётчиком", () => {
        for (const message of ["one", "two", "three", "four", "five"]) {
            notifications.show({ severity: "error", message, modal: false, items: [] });
        }
        const text = screen();

        // Видны САМЫЕ НОВЫЕ: прятать свежее ради старого бессмысленно.
        expect(text).toContain("five");
        expect(text).toContain("four");
        expect(text).toContain("three");
        expect(text).not.toContain("one");
        expect(text).toContain(`+${String(5 - MAX_VISIBLE_TOASTS)} more`);
    });

    it("info гаснет сам и уходит с кадра", () => {
        vi.useFakeTimers();
        notifications.show({ severity: "info", message: "transient", modal: false, items: [] });
        expect(screen()).toContain("transient");

        vi.advanceTimersByTime(NOTIFICATION_AUTO_HIDE_MS);
        expect(screen()).not.toContain("transient");
    });

    it("вопрос с кнопками фокуса НЕ забирает: набор в редакторе продолжается", () => {
        const before = h.testApp.focusedElement;
        notifications.show({
            severity: "warn",
            message: "Activate Supermaven?",
            modal: false,
            items: ["Activate", "Free"],
        });
        const text = screen();

        expect(text).toContain("Activate");
        expect(text).toContain("F6 — ответить");
        expect(h.testApp.focusedElement).toBe(before);
    });

    it("команда фокуса ведёт на кнопки, Enter отдаёт ответ", async () => {
        const answered = notifications.show({
            severity: "warn",
            message: "Activate?",
            modal: false,
            items: ["Activate", "Free"],
        });
        screen();

        await h.commands.execute("notifications.focusMessage");
        h.testApp.render();
        // Подсказка сменилась — фокус внутри тоста.
        expect(screen()).toContain("Enter — выбрать");

        h.testApp.sendKey("ArrowRight");
        h.testApp.sendKey("Enter");

        await expect(answered.answered).resolves.toBe(1);
        expect(screen()).not.toContain("Activate?");
    });

    it("Escape в тосте закрывает вопрос без выбора", async () => {
        const answered = notifications.show({
            severity: "warn",
            message: "Activate?",
            modal: false,
            items: ["Activate"],
        });
        screen();
        await h.commands.execute("notifications.focusMessage");
        h.testApp.sendKey("Escape");

        await expect(answered.answered).resolves.toBeUndefined();
        expect(screen()).not.toContain("Activate?");
    });

    it("команда Clear All убирает всё с кадра", async () => {
        notifications.show({ severity: "error", message: "boom", modal: false, items: [] });
        const answered = notifications.show({ severity: "info", message: "Activate?", modal: false, items: ["One"] });
        expect(screen()).toContain("boom");

        await h.commands.execute("notifications.clearAll");

        const text = screen();
        expect(text).not.toContain("boom");
        expect(text).not.toContain("Activate?");
        await expect(answered.answered).resolves.toBeUndefined();
    });

    it("модальное сообщение поднимает окно по центру и держит клавиатуру", async () => {
        const answered = notifications.show({
            severity: "warn",
            message: "Delete 12 files?",
            detail: "Нельзя отменить.",
            modal: true,
            items: ["Delete", "Cancel"],
            closeAffordance: 1,
        });
        const rows = screen().split("\n");

        expect(rows.join("\n")).toContain("Delete 12 files?");
        expect(rows.join("\n")).toContain("Нельзя отменить.");
        // Окно по центру, а не в углу: левая граница далеко от правого края.
        const left = rows.find((row) => row.includes("╭"))?.indexOf("╭") ?? -1;
        expect(left).toBeGreaterThan(0);
        expect(left).toBeLessThan(h.testApp.root.layoutSize.width - 1 - TOAST_WIDTH);

        h.testApp.sendKey("Escape");
        // Escape у модального отдаёт кнопку isCloseAffordance.
        await expect(answered.answered).resolves.toBe(1);
    });

    it("следующий вопрос показывается сам, когда на предыдущий ответили", async () => {
        const first = notifications.show({ severity: "info", message: "first?", modal: false, items: ["One"] });
        notifications.show({ severity: "info", message: "second?", modal: false, items: ["Two"] });

        expect(screen()).toContain("first?");
        expect(screen()).not.toContain("second?");

        notifications.answer(first.id, 0);
        await first.answered;
        expect(screen()).toContain("second?");
    });

    it("после закрытия вопроса пассивный стек опускается к статус-бару", () => {
        notifications.show({ severity: "error", message: "sticky", modal: false, items: [] });
        const ask = notifications.show({ severity: "info", message: "question?", modal: false, items: ["One"] });
        const withAsk = screen()
            .split("\n")
            .findIndex((row) => row.includes("sticky"));

        notifications.dismiss(ask.id);
        const withoutAsk = screen()
            .split("\n")
            .findIndex((row) => row.includes("sticky"));

        expect(withAsk).toBeGreaterThan(0);
        expect(withoutAsk).toBeGreaterThan(withAsk);
    });

    it("команда фокуса без живого вопроса ничего не делает", async () => {
        const before = h.testApp.focusedElement;
        await h.commands.execute("notifications.focusMessage");
        expect(h.testApp.focusedElement).toBe(before);
        expect(h.container.get(NotificationsComponentDIToken).getOpenAsk()).toBeNull();
    });
});
