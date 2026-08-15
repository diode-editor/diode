import type { ITerminalBackend } from "@tuidom/core/backend/iTerminalBackend";
import type { TuiApplication } from "@tuidom/core/dom/tuiApplication";
import type { ILanguageService } from "../../editor/common/languages/iLanguageService.ts";
import type { ITokenStyleResolver } from "../../editor/common/languages/iTokenStyleResolver.ts";
import type { TokenizationRegistry } from "../../editor/common/languages/tokenizationRegistry.ts";
import type { IClipboard } from "../../platform/clipboard/common/iClipboard.ts";
import type { IFileClipboard } from "../../platform/clipboard/common/iFileClipboard.ts";
import type { IFileSystemProviderRegistry } from "../../platform/files/common/iFileSystemProviderRegistry.ts";
import type { ServiceAccessor } from "../../platform/instantiation/common/diContainer.ts";
import { token } from "../../platform/instantiation/common/diContainer.ts";
import type { MarkerService } from "../../platform/markers/common/markerService.ts";
import type { IStateService } from "../../platform/state/common/iStateService.ts";

export const ServiceAccessorDIToken = token<ServiceAccessor>("ServiceAccessor");
export const TuiApplicationDIToken = token<TuiApplication>("TuiApplication");
export const ClipboardDIToken = token<IClipboard>("Clipboard");
export const FileClipboardDIToken = token<IFileClipboard>("FileClipboard");
export const TerminalBackendDIToken = token<ITerminalBackend>("TerminalBackend");
export const TokenizationRegistryDIToken = token<TokenizationRegistry>("TokenizationRegistry");
export const TokenStyleResolverDIToken = token<ITokenStyleResolver>("TokenStyleResolver");
export const LanguageServiceDIToken = token<ILanguageService>("LanguageService");
export const MarkerServiceDIToken = token<MarkerService>("MarkerService");
/** DI-токен машинного состояния UI/сессии ({@link IStateService}, см. docs/arch/State.md). */
export const StateServiceDIToken = token<IStateService>("StateService");
/** Absolute path of the active-profile Vexx settings.json, or null when unknown (tests/demo). */
export const SettingsResourceDIToken = token<string | null>("SettingsResource");
/** Absolute path of the active-profile Vexx keybindings.json, or null when unknown (tests/demo). */
export const KeybindingsResourceDIToken = token<string | null>("KeybindingsResource");
/**
 * Реестр поставщиков содержимого по схеме URI ({@link IFileSystemProviderRegistry}).
 * Наполняется адаптером extension host'а: расширения регистрируют провайдеров
 * (встроенный git — схему `git:`), потребители читают недисковые ресурсы.
 */
export const FileSystemProviderRegistryDIToken = token<IFileSystemProviderRegistry>("FileSystemProviderRegistry");
