import { describe, expect, it } from "vitest";

import type { ILogService, ILogSink, LogEntry } from "../../../../platform/log/common/iLogService.ts";
import { LogService } from "../../../../platform/log/common/logService.ts";
import { LogLevel } from "../../../../platform/log/common/logLevel.ts";
import { RingBufferSink } from "../../../../platform/log/common/ringBufferSink.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";

import { OutputChannelRegistry } from "./outputChannelRegistry.ts";
import { formatOutputLine, OutputService } from "./outputService.ts";

/** Настоящие LogService + RingBufferSink: связка и есть предмет теста. */
function createStack() {
    const logService = new LogService();
    const history = new RingBufferSink();
    logService.addSink(history as ILogSink);
    const registry = new OutputChannelRegistry();
    const contextKeys = new ContextKeyService();
    return { logService, history, registry, contextKeys };
}

function createService(stack: ReturnType<typeof createStack>): OutputService {
    return new OutputService(stack.history, stack.logService as ILogService, stack.registry, stack.contextKeys);
}

function entry(overrides: Partial<LogEntry> = {}): LogEntry {
    return {
        timestamp: Date.UTC(2026, 0, 1, 12, 4, 31, 220),
        channel: "bootstrap",
        level: LogLevel.Info,
        message: "diode starting",
        args: [],
        ...overrides,
    };
}

describe("formatOutputLine", () => {
    it("кладёт уровень в скобки — под стоковую грамматику log", () => {
        // Грамматика extensions/log подсвечивает именно `[info]`/`[warn]`/`[error]`,
        // поэтому форма скобок — часть контракта, а не косметика.
        const line = formatOutputLine(entry({ level: LogLevel.Warn, message: "activationEvents empty" }));
        expect(line).toContain("[warn] activationEvents empty");
    });

    it("печатает время как HH:MM:SS.mmm", () => {
        const timestamp = Date.UTC(2026, 0, 1, 12, 4, 31, 220);
        const d = new Date(timestamp);
        const pad = (n: number, w = 2) => String(n).padStart(w, "0");
        // Ожидание считаем из тех же полей Date — тест про ФОРМАТ, а не про
        // часовой пояс машины, где он гоняется.
        const expected = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
        expect(formatOutputLine(entry({ timestamp })).slice(0, expected.length)).toBe(expected);
        expect(expected).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
    });

    it("дописывает args JSON-ом", () => {
        const line = formatOutputLine(entry({ message: "activate failed", args: [{ id: "git" }] }));
        expect(line).toContain('activate failed {"id":"git"}');
    });

    it("несериализуемый аргумент не роняет форматирование", () => {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        expect(() => formatOutputLine(entry({ args: [cyclic] }))).not.toThrow();
    });

    it("undefined в args не превращается в пустоту", () => {
        // JSON.stringify(undefined) === undefined — без фоллбэка строка молча
        // теряла бы аргумент.
        expect(formatOutputLine(entry({ args: [undefined] }))).toContain("undefined");
    });
});

describe("OutputService: каналы", () => {
    it("подхватывает каналы, писавшие до подъёма сервиса", () => {
        const stack = createStack();
        stack.logService.createLogger("bootstrap").info("early");

        const service = createService(stack);

        expect(service.getChannels().map((c) => c.id)).toContain("bootstrap");
        service.dispose();
    });

    it("первый известный канал становится активным", () => {
        const stack = createStack();
        stack.logService.createLogger("bootstrap").info("early");

        const service = createService(stack);

        expect(service.getActiveChannelId()).toBe("bootstrap");
        service.dispose();
    });

    it("канал, появившийся в живом потоке, авторегистрируется", () => {
        // Логгер заводится ad hoc — если не добирать, подсистема не попала бы в
        // селектор и её лог был бы недоступен.
        const stack = createStack();
        const service = createService(stack);
        expect(service.getChannels()).toHaveLength(0);

        stack.logService.createLogger("files.watcher").info("watching");

        expect(service.getChannels().map((c) => c.id)).toEqual(["files.watcher"]);
        service.dispose();
    });

    it("объявленный label не перетирается авторегистрацией", () => {
        const stack = createStack();
        stack.registry.registerChannel({ id: "extensions.host", label: "Extension Host" });
        const service = createService(stack);

        stack.logService.createLogger("extensions.host").info("started");

        expect(service.getChannels()).toEqual([{ id: "extensions.host", label: "Extension Host" }]);
        service.dispose();
    });

    it("канал, объявленный позже, становится активным, если активного не было", () => {
        const stack = createStack();
        const service = createService(stack);
        expect(service.getActiveChannelId()).toBeNull();

        stack.registry.registerChannel({ id: "later", label: "Later" });

        expect(service.getActiveChannelId()).toBe("later");
        service.dispose();
    });
});

describe("OutputService: активный канал", () => {
    function serviceWithTwoChannels() {
        const stack = createStack();
        stack.logService.createLogger("bootstrap").info("boot");
        stack.logService.createLogger("configuration").info("config");
        return { stack, service: createService(stack) };
    }

    it("showChannel переключает и файрит событие", () => {
        const { service } = serviceWithTwoChannels();
        const seen: string[] = [];
        service.onDidChangeActiveChannel((id) => seen.push(id));

        service.showChannel("configuration");

        expect(service.getActiveChannelId()).toBe("configuration");
        expect(seen).toEqual(["configuration"]);
        service.dispose();
    });

    it("повторный showChannel того же канала не файрит", () => {
        const { service } = serviceWithTwoChannels();
        let fired = 0;
        service.onDidChangeActiveChannel(() => fired++);

        service.showChannel("bootstrap");

        expect(fired).toBe(0);
        service.dispose();
    });

    it("контекст-ключ activeOutputChannel обновлён ДО рассылки события", () => {
        // На этом ключе висит `toggled` пунктов селектора. Пока ключ ставил
        // подписчик, он успевал отработать позже того, кто пункты перечитывает, —
        // и селектор показывал прошлый канал при уже переключённом содержимом.
        const { stack, service } = serviceWithTwoChannels();
        let keyAtNotify: unknown;
        service.onDidChangeActiveChannel(() => {
            keyAtNotify = stack.contextKeys.get("activeOutputChannel");
        });

        service.showChannel("configuration");

        expect(keyAtNotify).toBe("configuration");
        service.dispose();
    });

    it("ключ выставлен уже при старте — по первому каналу", () => {
        const { stack, service } = serviceWithTwoChannels();
        expect(stack.contextKeys.get("activeOutputChannel")).toBe("bootstrap");
        service.dispose();
    });

    it("без каналов ключ пустой, а не undefined", () => {
        const stack = createStack();
        const service = createService(stack);
        expect(stack.contextKeys.get("activeOutputChannel")).toBe("");
        service.dispose();
    });

    it("неизвестный канал игнорируется", () => {
        const { service } = serviceWithTwoChannels();

        service.showChannel("nope");

        expect(service.getActiveChannelId()).toBe("bootstrap");
        service.dispose();
    });
});

describe("OutputService: содержимое и живой хвост", () => {
    it("renderChannel отдаёт историю канала построчно", () => {
        const stack = createStack();
        const logger = stack.logService.createLogger("bootstrap");
        logger.info("first");
        logger.warn("second");
        const service = createService(stack);

        const text = service.renderChannel("bootstrap");

        expect(text.split("\n").filter(Boolean)).toHaveLength(2);
        expect(text).toContain("[info] first");
        expect(text).toContain("[warn] second");
        expect(text.endsWith("\n")).toBe(true);
        service.dispose();
    });

    it("пустой канал рендерится пустой строкой", () => {
        const stack = createStack();
        const service = createService(stack);
        expect(service.renderChannel("nope")).toBe("");
        service.dispose();
    });

    it("хвост приходит только по активному каналу", () => {
        const stack = createStack();
        stack.logService.createLogger("bootstrap").info("boot");
        stack.logService.createLogger("configuration").info("config");
        const service = createService(stack);
        const seen: string[] = [];
        service.onDidAppendToActiveChannel((e) => seen.push(e.message));

        stack.logService.createLogger("configuration").info("ignored");
        stack.logService.createLogger("bootstrap").info("tailed");

        expect(seen).toEqual(["tailed"]);
        service.dispose();
    });

    it("после смены активного канала хвост идёт из него", () => {
        const stack = createStack();
        stack.logService.createLogger("bootstrap").info("boot");
        stack.logService.createLogger("configuration").info("config");
        const service = createService(stack);
        const seen: string[] = [];
        service.onDidAppendToActiveChannel((e) => seen.push(e.message));

        service.showChannel("configuration");
        stack.logService.createLogger("configuration").info("now tailed");
        stack.logService.createLogger("bootstrap").info("now ignored");

        expect(seen).toEqual(["now tailed"]);
        service.dispose();
    });

    it("подписка снимается по dispose", () => {
        const stack = createStack();
        stack.logService.createLogger("bootstrap").info("boot");
        const service = createService(stack);
        const seen: string[] = [];
        const sub = service.onDidAppendToActiveChannel((e) => seen.push(e.message));

        sub.dispose();
        stack.logService.createLogger("bootstrap").info("after");

        expect(seen).toEqual([]);
        service.dispose();
    });
});
