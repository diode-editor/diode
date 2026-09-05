import { cpSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startHeadlessApp } from "../helpers/appSession.ts";
import { findNode } from "../helpers/inspectorClient.ts";

/**
 * Смоук-чеки расширений реестра: «поставилось» — половина ответа, вторая половина
 * — «работает в Diode на текущем коде». Каждая запись реестра обязана иметь чек
 * здесь, иначе `marketplace.test.ts` краснеет: добавить расширение в магазин, не
 * проверив его в редакторе, — ровно то, чего курируемость не допускает.
 *
 * Чек дёргает настоящую функциональность расширения и смотрит на состояние
 * редактора, а не на факт загрузки: фикстура, выведенная из своей же реализации,
 * проверяет только то, что и так работает (см. AGENTS.md, урок #194/#195).
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES = resolve(here, "..", "fixtures");

export interface ICheckContext {
    /** Корень сессии; в `<root>/user-data-dir` расширение уже установлено из реестра. */
    readonly root: string;
}

export interface IMarketplaceCheck {
    /** id записи в реестре. */
    readonly id: string;
    /** Пути внутри каталога установленного расширения, обязанные существовать. */
    readonly expectFiles: readonly string[];
    /** Поднимает редактор на этом user-data-dir и проверяет работу расширения. */
    run(ctx: ICheckContext): Promise<void>;
}

/**
 * Открывает файл и ждёт, пока расширение проставит `tabSize` активному редактору.
 * Наблюдаемый эффект настоящего кода расширения, снимаемый инспектором, — без
 * ввода в PTY, поэтому чек работает на всех платформах.
 */
async function expectTabSize(ctx: ICheckContext, file: string, tabSize: number): Promise<void> {
    const app = await startHeadlessApp({ root: ctx.root, keepRoot: true, open: [file] });
    try {
        await app.session.waitForDocument(
            (root) => findNode(root, (n) => n.type === "EditorElement")?.state?.tabSize === tabSize,
            { timeoutMs: 40_000 },
        );
    } finally {
        await app.dispose();
    }
}

export const MARKETPLACE_CHECKS: readonly IMarketplaceCheck[] = [
    {
        // kind: "native" — наш артефакт, раздаётся с Pages.
        id: "test.tab-setter",
        expectFiles: ["package.json", "extension.js"],
        run: async (ctx) => {
            // Расширение при активации ставит tabSize=7 активному редактору через
            // `vscode.window.activeTextEditor.options` — то есть проверяется и
            // subprocess extension host, и RPC до него.
            await expectTabSize(ctx, join(FIXTURES, "tabbed.txt"), 7);
        },
    },
    {
        // kind: "proxy-openvsx" — чужой .vsix, скачивается с open-vsx по URL из меты.
        id: "EditorConfig.EditorConfig",
        expectFiles: ["package.json", "out/editorConfigMain.js", "node_modules/editorconfig/lib/index.js"],
        run: async (ctx) => {
            // `[*.tabbed] indent_size = 3` из .editorconfig проекта: расширение
            // читает конфиг и применяет его к открытому файлу. Проект копируем в
            // корень сессии, чтобы прогон не зависел от .editorconfig репозитория.
            const project = join(ctx.root, "editorconfig-project");
            cpSync(join(FIXTURES, "editorconfig", "project"), project, { recursive: true });
            await expectTabSize(ctx, join(project, "indent.tabbed"), 3);
        },
    },
];
