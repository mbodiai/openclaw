#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";

const CONTROL_UI_URL = process.env.OPENCLAW_CONTROL_UI_URL?.trim() || "https://chat.mbodi.ai/";
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
const SCREENSHOT_DIR =
  process.env.OPENCLAW_SCREENSHOT_DIR?.trim() || "ui/test-results/chat.mbodi.ai";
const PROFILE_DIR =
  process.env.OPENCLAW_PLAYWRIGHT_PROFILE_DIR?.trim() || "ui/test-results/chat.mbodi.ai.profile";
const IMAGE_PATH = process.env.OPENCLAW_CHAT_IMAGE?.trim() || "ui/public/favicon-32.png";
const CHAT_MESSAGE =
  process.env.OPENCLAW_CHAT_MESSAGE?.trim() ||
  `Playwright smoke test (${new Date().toISOString()})`;

const CHROME_EXECUTABLE =
  process.env.PLAYWRIGHT_CHROME_EXECUTABLE?.trim() ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

if (!GATEWAY_TOKEN) {
  console.error("Missing OPENCLAW_GATEWAY_TOKEN.");
  process.exit(1);
}

function resolveUrl(pathname) {
  return new URL(pathname, CONTROL_UI_URL).toString();
}

function resolveAuthedUrl(pathname) {
  const url = new URL(resolveUrl(pathname));
  url.searchParams.set("token", GATEWAY_TOKEN);
  return url.toString();
}

async function screenshot(page, name) {
  const filePath = path.join(SCREENSHOT_DIR, name);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function waitForChatReady(page) {
  const textarea = page.locator(".chat-compose textarea");
  await textarea.waitFor({ state: "visible", timeout: 15000 });

  const danger = page.locator(".callout.danger").first();
  const startedAt = Date.now();

  while (Date.now() - startedAt < 15000) {
    if (await textarea.isEnabled()) {
      return { ok: true };
    }
    if (await danger.isVisible().catch(() => false)) {
      const message = await danger.innerText().catch(() => "");
      return { ok: false, message };
    }
    await page.waitForTimeout(200);
  }

  return { ok: false, message: "Timeout waiting for Control UI to connect." };
}

async function main() {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  await fs.mkdir(PROFILE_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    executablePath: CHROME_EXECUTABLE,
    viewport: { width: 1280, height: 720 },
  });

  try {
    const page = await context.newPage();
    // Avoid triggering failed-auth rate limiting: hydrate token from URL on first load.
    await page.goto(resolveAuthedUrl("/"), { waitUntil: "domcontentloaded" });

    const ready = await waitForChatReady(page);
    await page.waitForTimeout(300);
    await screenshot(page, "01-main.png");

    if (!ready.ok) {
      console.error("Control UI is not connected.");
      if (ready.message) {
        console.error(ready.message);
      }
      console.error(
        `If you see "pairing required", approve the device then rerun:\n` +
          `  ssh aditya-oracle 'cd ~/openclaw && node openclaw.mjs devices list && node openclaw.mjs devices approve <requestId>'`,
      );
      process.exit(2);
    }

    await page.locator('input[type="file"][accept="image/*"]').setInputFiles(IMAGE_PATH);
    await page.waitForSelector(".chat-attachments img.chat-attachment__img", { timeout: 5000 });
    await screenshot(page, "02-attachment.png");

    await page.locator(".chat-compose textarea").fill(CHAT_MESSAGE);
    await page.locator(".chat-compose__actions .btn.primary").click();
    await page.locator(".chat-thread").getByText(CHAT_MESSAGE).waitFor({ timeout: 5000 });
    await page.waitForSelector(".chat-message-images img.chat-message-image", { timeout: 5000 });
    await page.waitForTimeout(300);
    await screenshot(page, "03-sent.png");
  } finally {
    await context.close();
  }
}

await main();
