import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { FSWatcher } from "chokidar";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConfigurationModel } from "../../../platform/configuration/common/configurationModel.ts";
import type { ITreeFileWatchOptions } from "../../../platform/files/common/iTreeFileWatcher.ts";
import { ChokidarTreeWatcher, isExcluded } from "../../../platform/files/node/chokidarTreeWatcher.ts";
import { parseWatcherExclude } from "../../api/browser/fileWatcherAdapter.ts";

import { filesConfiguration } from "./filesConfiguration.ts";

const DEFAULT_EXCLUDES = parseWatcherExclude(filesConfiguration.properties["files.watcherExclude"].default);

describe("filesConfiguration — files.watcherExclude, схема", () => {
    it("object с описанием про матчинг относительно корня watch'а", () => {
        const schema = filesConfiguration.properties["files.watcherExclude"];
        expect(schema.type).toBe("object");
        expect(schema.description).toContain("relative to the watched folder");
    });

    it("все дефолтные шаблоны включены: карта `{ glob: true }`, как в VS Code", () => {
        const value = filesConfiguration.properties["files.watcherExclude"].default as Record<string, unknown>;
        expect(Object.values(value).every((enabled) => enabled === true)).toBe(true);
        expect(DEFAULT_EXCLUDES.length).toBe(Object.keys(value).length);
    });
});

// Что именно режут дефолты. Таблица перечисляет пути ЯВНО (а не выводится из
// самих шаблонов): иначе тест переписывался бы вместе с опечаткой в дефолте и
// ничего не проверял. Пути — относительно корня watch'а, как их видит
// `isExcluded`.
describe("filesConfiguration — files.watcherExclude, дефолты на живых путях", () => {
    const excluded = [
        // Служебные каталоги VCS — целиком, на любой глубине.
        ".git",
        "sub/.git",
        ".hg",
        ".svn",
        // Зависимости и окружения.
        "node_modules",
        "packages/app/node_modules",
        ".venv",
        // Сборка и отчёты.
        "dist",
        "out",
        "build",
        "target",
        "coverage",
        // Кеши инструментов.
        ".cache",
        ".gradle",
        ".next",
        ".turbo",
        "__pycache__",
        "src/pkg/__pycache__",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        ".stryker-tmp",
        // Worktree агентов.
        ".claude/worktrees",
    ];

    const kept = [
        // Похожие имена, которые режущими шаблонами задеваться не должны.
        ".gitignore",
        ".gitattributes",
        "src",
        "src/main.ts",
        "docs/build.md",
        "distribution",
        "outline.ts",
        "node_modules_backup",
        // `.claude` исключён не весь: настройки и скиллы правят руками.
        ".claude",
        ".claude/settings.json",
        ".claude/skills/run/SKILL.md",
    ];

    it.each(excluded)("исключён: %s", (relative) => {
        expect(isExcluded("/repo", path.join("/repo", relative), DEFAULT_EXCLUDES)).toBe(true);
    });

    it.each(kept)("под слежением остаётся: %s", (relative) => {
        expect(isExcluded("/repo", path.join("/repo", relative), DEFAULT_EXCLUDES)).toBe(false);
    });

    it("исключается сам каталог, а не только его содержимое", () => {
        // Ради этого дефолты и переписаны в форму `**/<имя>`: chokidar не
        // заходит только в тот каталог, который исключён сам. Шаблон на
        // содержимое (`**/node_modules/**`) каталог не матчит — обход в него
        // всё равно спускается.
        expect(isExcluded("/repo", "/repo/node_modules", ["**/node_modules/**"])).toBe(false);
        expect(isExcluded("/repo", "/repo/node_modules", DEFAULT_EXCLUDES)).toBe(true);
    });

    it("`**/.git` не задевает собственный watcher расширения git", () => {
        // Расширение git следит за служебным каталогом отдельным watcher'ом, у
        // которого корень — сам `.git` (`startWatchers` в extensions/git/main.ts).
        // Пути там считаются относительно этого корня, шаблона `.git` в них нет
        // — checkout, commit и stage расширение видит по-прежнему.
        expect(isExcluded("/repo/.git", "/repo/.git/HEAD", DEFAULT_EXCLUDES)).toBe(false);
        expect(isExcluded("/repo/.git", "/repo/.git/index", DEFAULT_EXCLUDES)).toBe(false);
        expect(isExcluded("/repo/.git", "/repo/.git/refs/heads/main", DEFAULT_EXCLUDES)).toBe(false);
    });
});

describe("filesConfiguration — files.watcherExclude, правка пользователем", () => {
    /** Собирает значение настройки так же, как ConfigurationService: defaults + user. */
    function merged(userValue: Record<string, boolean>): string[] {
        const defaults = ConfigurationModel.fromRaw({
            "files.watcherExclude": filesConfiguration.properties["files.watcherExclude"].default,
        });
        const user = ConfigurationModel.fromRaw({ "files.watcherExclude": userValue });
        return parseWatcherExclude(ConfigurationModel.merge(defaults, user).get("files.watcherExclude"));
    }

    it("свой шаблон добавляется к дефолтным, а не заменяет их", () => {
        const patterns = merged({ "**/vendor": true });
        expect(patterns).toContain("**/vendor");
        expect(patterns).toContain("**/node_modules");
    });

    it("ненужный дефолт гасится значением false", () => {
        const patterns = merged({ "**/dist": false });
        expect(patterns).not.toContain("**/dist");
        expect(patterns).toContain("**/node_modules");
        expect(isExcluded("/repo", "/repo/dist", patterns)).toBe(false);
    });
});

/** Ловит настоящий FSWatcher, который создаёт базовый класс, — ради `getWatched()`. */
class CapturingTreeWatcher extends ChokidarTreeWatcher {
    public captured: FSWatcher | undefined;
    protected override createWatcher(rootPath: string, options: ITreeFileWatchOptions): FSWatcher {
        this.captured = super.createWatcher(rootPath, options);
        return this.captured;
    }
}

describe("filesConfiguration — files.watcherExclude на живом обходе", () => {
    let root: string;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "diode-watcher-defaults-"));
        for (const dir of [
            "src/app",
            "node_modules/pkg/lib",
            ".git/objects/ab",
            ".claude/worktrees/feature/src",
            ".claude/skills",
            "dist/assets",
            "coverage/lcov-report",
        ]) {
            fs.mkdirSync(path.join(root, dir), { recursive: true });
        }
    });

    afterAll(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    /** Каталоги, на которые chokidar реально подписался, — относительно корня. */
    async function watchedDirs(excludes: readonly string[]): Promise<string[]> {
        const watcher = new CapturingTreeWatcher();
        const subscription = watcher.watchTree(root, { recursive: true, excludes }, () => {
            /* события в этом тесте не нужны: смотрим на сам обход */
        });
        try {
            await new Promise((resolve) => setTimeout(resolve, 600));
            return Object.keys(watcher.captured?.getWatched() ?? {})
                .map((dir) => path.relative(root, dir).split(path.sep).join("/"))
                .filter((relative) => relative !== "");
        } finally {
            subscription.dispose();
        }
    }

    it("в исключённые каталоги обход не заходит вовсе", async () => {
        const watched = await watchedDirs(DEFAULT_EXCLUDES);
        // Своё дерево — под слежением.
        expect(watched).toContain("src");
        expect(watched).toContain("src/app");
        expect(watched).toContain(".claude");
        expect(watched).toContain(".claude/skills");
        // Исключённое — не просто отфильтровано по событиям, а не посещено:
        // ни самого каталога, ни его содержимого в подписке нет.
        expect(watched.filter((dir) => dir.startsWith("node_modules"))).toEqual([]);
        expect(watched.filter((dir) => dir.startsWith(".git"))).toEqual([]);
        expect(watched.filter((dir) => dir.startsWith(".claude/worktrees"))).toEqual([]);
        expect(watched.filter((dir) => dir.startsWith("dist"))).toEqual([]);
        expect(watched.filter((dir) => dir.startsWith("coverage"))).toEqual([]);
    }, 20000);

    it("шаблон на содержимое оставлял бы watch на самом каталоге", async () => {
        // Цена прежней формы дефолта: chokidar подписывается на
        // `node_modules`, читает его целиком и stat'ит каждый вход — и только
        // потом выбрасывает детей. Отсюда и лишние inotify-watch'и.
        const watched = await watchedDirs(["**/node_modules/**"]);
        expect(watched).toContain("node_modules");
        expect(watched).not.toContain("node_modules/pkg");
    }, 20000);
});
