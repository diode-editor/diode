import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

/**
 * Настройки задач (`task.*`) — ключи, дефолты, enum и описания дословно из
 * `task.contribution.ts` эталона (у ключей без `scope` там действует
 * `window`). Не зарегистрированы (функции нет): `task.problemMatchers.neverPrompt`,
 * `task.quickOpen.history`, `task.quickOpen.showAll`, `task.allowAutomaticTasks`,
 * `task.reconnection`, `task.notifyWindowOnTaskCompletion`, `task.showDecorations`
 * — см. docs/TODO/Tasks.md. `markdownDescription` эталона (autoDetect,
 * slowProviderWarning, quickOpen.detail, saveBeforeRun) идёт в `description`:
 * markdown-описаний реестр настроек Diode не знает.
 */
export const tasksConfiguration = {
    id: "task",
    title: "Tasks",
    properties: {
        "task.autoDetect": {
            scope: "window",
            type: "string",
            enum: ["on", "off"],
            default: "on",
            description:
                "Controls enablement of `provideTasks` for all task provider extension. If the Tasks: Run Task command is slow, disabling auto detect for task providers may help. Individual extensions may also provide settings that disable auto detection.",
        },
        // `oneOf` эталона (булево для всех задач или массив типов) — списком типов значения.
        "task.slowProviderWarning": {
            scope: "window",
            type: ["boolean", "array"],
            default: true,
            description: "Configures whether a warning is shown when a provider is slow",
        },
        "task.quickOpen.detail": {
            scope: "window",
            type: "boolean",
            default: true,
            description:
                "Controls whether to show the task detail for tasks that have a detail in task quick picks, such as Run Task.",
        },
        "task.quickOpen.skip": {
            scope: "window",
            type: "boolean",
            default: false,
            description: "Controls whether the task quick pick is skipped when there is only one task to pick from.",
        },
        "task.saveBeforeRun": {
            scope: "window",
            type: "string",
            enum: ["always", "never", "prompt"],
            enumDescriptions: [
                "Always saves all editors before running.",
                "Never saves editors before running.",
                "Prompts whether to save editors before running.",
            ],
            default: "always",
            description: "Save all dirty editors before running a task.",
        },
        "task.verboseLogging": {
            scope: "window",
            type: "boolean",
            default: false,
            description: "Enable verbose logging for tasks.",
        },
    },
} as const satisfies IConfigurationNode;
