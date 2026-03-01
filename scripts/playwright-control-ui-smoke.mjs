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
const CHAT_MESSAGE = process.env.OPENCLAW_CHAT_MESSAGE?.trim() || "Playwright smoke test";

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

async function screenshot(page, name) {
  const filePath = path.join(SCREENSHOT_DIR, name);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
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
    await page.goto(CONTROL_UI_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(300);

    await screenshot(page, "01-chat-initial.png");

    await page.goto(resolveUrl("/overview"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(300);
    await screenshot(page, "02-overview.png");

    await page.locator('input[placeholder="OPENCLAW_GATEWAY_TOKEN"]').fill(GATEWAY_TOKEN);
    await page.getByRole("button", { name: /connect/i }).click();

    const connected = page.locator(".stat-value.ok");
    const danger = page.locator(".callout.danger");

    const outcome = await Promise.race([
      connected.waitFor({ timeout: 15000 }).then(() => "connected"),
      danger.waitFor({ timeout: 15000 }).then(() => "error"),
    ]).catch(() => "timeout");

    await page.waitForTimeout(300);
    await screenshot(page, "03-overview-after-connect.png");

    if (outcome !== "connected") {
      const errText = await danger.innerText().catch(() => "");
      console.error("Control UI is not connected.");
      if (errText) {
        console.error(errText);
      }
      console.error(
        `If you see "pairing required", approve the device then rerun:\n` +
          `  ssh aditya-oracle 'cd ~/openclaw && node openclaw.mjs devices list && node openclaw.mjs devices approve <requestId>'`,
      );
      process.exit(2);
    }

    await page.goto(resolveUrl("/chat"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(300);
    await screenshot(page, "04-chat.png");

    await page.locator('input[type="file"][accept="image/*"]').setInputFiles(IMAGE_PATH);
    await page.waitForSelector(".chat-attachments img.chat-attachment__img", { timeout: 5000 });
    await screenshot(page, "05-chat-attachment.png");

    await page.locator(".chat-compose textarea").fill(CHAT_MESSAGE);
    await page.locator(".chat-compose__actions .btn.primary").click();
    await page.waitForTimeout(600);
    await screenshot(page, "06-chat-sent.png");
  } finally {
    await context.close();
  }
}

await main();
