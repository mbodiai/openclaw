import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Bot } from "grammy";
import { resolveStateDir } from "../../../src/config/paths.js";
import {
  normalizeTelegramCommandName,
  TELEGRAM_COMMAND_NAME_PATTERN,
} from "../../../src/config/telegram-custom-commands.js";
import { logVerbose } from "../../../src/globals.js";
import type { RuntimeEnv } from "../../../src/runtime.js";
import { withTelegramApiErrorLogging } from "./api-logging.js";

export const TELEGRAM_MAX_COMMANDS = 100;
const TELEGRAM_COMMAND_ACCEPTANCE_LOG_PREFIX =
  "Reduce plugin/skill/custom commands to expose more menu entries.";

export type TelegramMenuCommand = {
  command: string;
  description: string;
};

type TelegramPluginCommandSpec = {
  name: unknown;
  description: unknown;
};

function isBotCommandsTooMuchError(err: unknown): boolean {
  if (!err) {
    return false;
  }
  const pattern = /\bBOT_COMMANDS_TOO_MUCH\b/i;
  if (typeof err === "string") {
    return pattern.test(err);
  }
  if (err instanceof Error) {
    if (pattern.test(err.message)) {
      return true;
    }
  }
  if (typeof err === "object") {
    const maybe = err as { description?: unknown; message?: unknown };
    if (typeof maybe.description === "string" && pattern.test(maybe.description)) {
      return true;
    }
    if (typeof maybe.message === "string" && pattern.test(maybe.message)) {
      return true;
    }
  }
  return false;
}

function formatTelegramCommandAcceptanceLog(params: {
  initialCount: number;
  acceptedCount: number;
}): string {
  const omittedCount = Math.max(0, params.initialCount - params.acceptedCount);
  return (
    `Telegram accepted ${params.acceptedCount} commands after BOT_COMMANDS_TOO_MUCH ` +
    `(started with ${params.initialCount}; omitted ${omittedCount}). ` +
    TELEGRAM_COMMAND_ACCEPTANCE_LOG_PREFIX
  );
}

export function buildPluginTelegramMenuCommands(params: {
  specs: TelegramPluginCommandSpec[];
  existingCommands: Set<string>;
}): { commands: TelegramMenuCommand[]; issues: string[] } {
  const { specs, existingCommands } = params;
  const commands: TelegramMenuCommand[] = [];
  const issues: string[] = [];
  const pluginCommandNames = new Set<string>();

  for (const spec of specs) {
    const rawName = typeof spec.name === "string" ? spec.name : "";
    const normalized = normalizeTelegramCommandName(rawName);
    if (!normalized || !TELEGRAM_COMMAND_NAME_PATTERN.test(normalized)) {
      const invalidName = rawName.trim() ? rawName : "<unknown>";
      issues.push(
        `Plugin command "/${invalidName}" is invalid for Telegram (use a-z, 0-9, underscore; max 32 chars).`,
      );
      continue;
    }
    const description = typeof spec.description === "string" ? spec.description.trim() : "";
    if (!description) {
      issues.push(`Plugin command "/${normalized}" is missing a description.`);
      continue;
    }
    if (existingCommands.has(normalized)) {
      if (pluginCommandNames.has(normalized)) {
        issues.push(`Plugin command "/${normalized}" is duplicated.`);
      } else {
        issues.push(`Plugin command "/${normalized}" conflicts with an existing Telegram command.`);
      }
      continue;
    }
    pluginCommandNames.add(normalized);
    existingCommands.add(normalized);
    commands.push({ command: normalized, description });
  }

  return { commands, issues };
}

export function buildCappedTelegramMenuCommands(params: {
  allCommands: TelegramMenuCommand[];
  maxCommands?: number;
}): {
  commandsToRegister: TelegramMenuCommand[];
  totalCommands: number;
  maxCommands: number;
  overflowCount: number;
} {
  const { allCommands } = params;
  const maxCommands = params.maxCommands ?? TELEGRAM_MAX_COMMANDS;
  const totalCommands = allCommands.length;
  const overflowCount = Math.max(0, totalCommands - maxCommands);
  const commandsToRegister = allCommands.slice(0, maxCommands);
  return { commandsToRegister, totalCommands, maxCommands, overflowCount };
}

/** Compute a stable hash of the command list for change detection. */
export function hashCommandList(commands: TelegramMenuCommand[]): string {
  const sorted = [...commands].toSorted((a, b) => a.command.localeCompare(b.command));
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex").slice(0, 16);
}

function hashBotIdentity(botIdentity?: string): string {
  const normalized = botIdentity?.trim();
  if (!normalized) {
    return "no-bot";
  }
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

function resolveCommandHashPath(accountId?: string, botIdentity?: string): string {
  const stateDir = resolveStateDir(process.env, os.homedir);
  const normalizedAccount = accountId?.trim().replace(/[^a-z0-9._-]+/gi, "_") || "default";
  const botHash = hashBotIdentity(botIdentity);
  return path.join(stateDir, "telegram", `command-hash-${normalizedAccount}-${botHash}.txt`);
}

async function readCachedCommandHash(
  accountId?: string,
  botIdentity?: string,
): Promise<string | null> {
  try {
    return (await fs.readFile(resolveCommandHashPath(accountId, botIdentity), "utf-8")).trim();
  } catch {
    return null;
  }
}

async function writeCachedCommandHash(
  accountId: string | undefined,
  botIdentity: string | undefined,
  hash: string,
): Promise<void> {
  const filePath = resolveCommandHashPath(accountId, botIdentity);
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, hash, "utf-8");
  } catch {
    // Best-effort: failing to cache the hash just means the next restart
    // will sync commands again, which is the pre-fix behaviour.
  }
}

export function syncTelegramMenuCommands(params: {
  bot: Bot;
  runtime: RuntimeEnv;
  commandsToRegister: TelegramMenuCommand[];
  accountId?: string;
  botIdentity?: string;
}): void {
  const { bot, runtime, commandsToRegister, accountId, botIdentity } = params;
  const sync = async () => {
    // Skip sync if the command list hasn't changed since the last successful
    // sync. This prevents hitting Telegram's 429 rate limit when the gateway
    // is restarted several times in quick succession.
    // See: openclaw/openclaw#32017
    const currentHash = hashCommandList(commandsToRegister);
    const cachedHash = await readCachedCommandHash(accountId, botIdentity);
    if (cachedHash === currentHash) {
      logVerbose("telegram: command menu unchanged; skipping sync");
      return;
    }

    // Keep delete -> set ordering to avoid stale deletions racing after fresh registrations.
    let deleteSucceeded = true;
    if (typeof bot.api.deleteMyCommands === "function") {
      deleteSucceeded = await withTelegramApiErrorLogging({
        operation: "deleteMyCommands",
        runtime,
        fn: () => bot.api.deleteMyCommands(),
      })
        .then(() => true)
        .catch(() => false);
    }

    if (commandsToRegister.length === 0) {
      if (!deleteSucceeded) {
        runtime.log?.("telegram: deleteMyCommands failed; skipping empty-menu hash cache write");
        return;
      }
      await writeCachedCommandHash(accountId, botIdentity, currentHash);
      return;
    }

    // Binary search for the maximum number of commands Telegram will accept.
    const initialCommandCount = commandsToRegister.length;
    let lo = 1;
    let hi = commandsToRegister.length;
    let lastAccepted = 0;

    // Try the full set first.
    try {
      await withTelegramApiErrorLogging({
        operation: "setMyCommands",
        runtime,
        shouldLog: (err) => !isBotCommandsTooMuchError(err),
        fn: () => bot.api.setMyCommands(commandsToRegister),
      });
      await writeCachedCommandHash(accountId, botIdentity, currentHash);
      return; // All commands accepted.
    } catch (err) {
      if (!isBotCommandsTooMuchError(err)) {
        throw err;
      }
      hi = commandsToRegister.length - 1;
    }

    // Binary search: find the highest count Telegram accepts.
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (mid <= 0) {
        break;
      }
      try {
        await withTelegramApiErrorLogging({
          operation: "setMyCommands",
          runtime,
          shouldLog: (err) => !isBotCommandsTooMuchError(err),
          fn: () => bot.api.setMyCommands(commandsToRegister.slice(0, mid)),
        });
        lastAccepted = mid;
        lo = mid + 1;
      } catch (err) {
        if (!isBotCommandsTooMuchError(err)) {
          throw err;
        }
        hi = mid - 1;
      }
    }

    if (lastAccepted > 0) {
      // Re-register with the best count found (last successful attempt may have been
      // overwritten by a failed higher attempt — Telegram deletes on failed set).
      if (lastAccepted < commandsToRegister.length) {
        try {
          await withTelegramApiErrorLogging({
            operation: "setMyCommands",
            runtime,
            shouldLog: (err) => !isBotCommandsTooMuchError(err),
            fn: () => bot.api.setMyCommands(commandsToRegister.slice(0, lastAccepted)),
          });
        } catch {
          // Best-effort; the last successful setMyCommands should still be active.
        }
      }
      await writeCachedCommandHash(accountId, botIdentity, currentHash);
      runtime.log?.(
        formatTelegramCommandAcceptanceLog({
          initialCount: initialCommandCount,
          acceptedCount: lastAccepted,
        }),
      );
    } else {
      runtime.error?.(
        "Telegram rejected native command registration (BOT_COMMANDS_TOO_MUCH); leaving menu empty. Reduce commands or disable channels.telegram.commands.native.",
      );
    }
  };

  void sync().catch((err) => {
    runtime.error?.(`Telegram command sync failed: ${String(err)}`);
  });
}
