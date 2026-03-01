import type { Bot } from "grammy";
import {
  normalizeTelegramCommandName,
  TELEGRAM_COMMAND_NAME_PATTERN,
} from "../config/telegram-custom-commands.js";
import type { RuntimeEnv } from "../runtime.js";
import { withTelegramApiErrorLogging } from "./api-logging.js";

export const TELEGRAM_MAX_COMMANDS = 100;

export type TelegramMenuCommand = {
  command: string;
  description: string;
};

type TelegramPluginCommandSpec = {
  name: string;
  description: string;
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

export function buildPluginTelegramMenuCommands(params: {
  specs: TelegramPluginCommandSpec[];
  existingCommands: Set<string>;
}): { commands: TelegramMenuCommand[]; issues: string[] } {
  const { specs, existingCommands } = params;
  const commands: TelegramMenuCommand[] = [];
  const issues: string[] = [];
  const pluginCommandNames = new Set<string>();

  for (const spec of specs) {
    const normalized = normalizeTelegramCommandName(spec.name);
    if (!normalized || !TELEGRAM_COMMAND_NAME_PATTERN.test(normalized)) {
      issues.push(
        `Plugin command "/${spec.name}" is invalid for Telegram (use a-z, 0-9, underscore; max 32 chars).`,
      );
      continue;
    }
    const description = spec.description.trim();
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

export function syncTelegramMenuCommands(params: {
  bot: Bot;
  runtime: RuntimeEnv;
  commandsToRegister: TelegramMenuCommand[];
}): void {
  const { bot, runtime, commandsToRegister } = params;
  const sync = async () => {
    // Keep delete -> set ordering to avoid stale deletions racing after fresh registrations.
    if (typeof bot.api.deleteMyCommands === "function") {
      await withTelegramApiErrorLogging({
        operation: "deleteMyCommands",
        runtime,
        fn: () => bot.api.deleteMyCommands(),
      }).catch(() => {});
    }

    if (commandsToRegister.length === 0) {
      return;
    }

    // Binary search for the maximum number of commands Telegram will accept.
    let lo = 1;
    let hi = commandsToRegister.length;
    let lastAccepted = 0;

    // Try the full set first.
    try {
      await withTelegramApiErrorLogging({
        operation: "setMyCommands",
        runtime,
        fn: () => bot.api.setMyCommands(commandsToRegister),
      });
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
            fn: () => bot.api.setMyCommands(commandsToRegister.slice(0, lastAccepted)),
          });
        } catch {
          // Best-effort; the last successful setMyCommands should still be active.
        }
      }
      runtime.log?.(
        `Telegram accepted ${lastAccepted}/${commandsToRegister.length} commands (API limit reached).`,
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
