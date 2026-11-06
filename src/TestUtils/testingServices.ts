import { ContextKeyService } from "../vs/platform/contextkey/common/contextKeyService.ts";
import { ExtensionTestingAdapter } from "../vs/workbench/contrib/testing/browser/extensionTestingAdapter.ts";
import { TestProfileService } from "../vs/workbench/contrib/testing/common/testProfileService.ts";
import { TestResultService } from "../vs/workbench/contrib/testing/common/testResultService.ts";
import { type ITestRunUi, TestService } from "../vs/workbench/contrib/testing/common/testService.ts";

export interface ITestingServicesOptions {
    readonly contextKeys?: ContextKeyService;
    /** The results' clock. */
    readonly now?: () => number;
    readonly saveAllBeforeTest?: () => Promise<void>;
}

/** The testing services wired as the workbench does; the UI hooks record what they were asked. */
export function makeTestingServices(options: ITestingServicesOptions = {}) {
    const contextKeys = options.contextKeys ?? new ContextKeyService();
    const results = new TestResultService(contextKeys, options.now);
    const profiles = new TestProfileService(contextKeys);
    const saves: number[] = [];
    const errors: string[] = [];
    const ui: ITestRunUi = {
        saveAllBeforeTest: async () => {
            saves.push(saves.length);
            await options.saveAllBeforeTest?.();
        },
        showError: (message) => {
            errors.push(message);
        },
    };
    const tests = new TestService(contextKeys, results, profiles, ui);
    const adapter = new ExtensionTestingAdapter(tests, profiles, results);
    return { contextKeys, results, profiles, tests, adapter, saves, errors };
}
