#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import process from "node:process";
import tls from "node:tls";

async function flyApi(config, method, path, body = null) {
  const url = `https://api.machines.dev/v1/apps/${config.appName}${path}`;
  const options = {
    method,
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  if (!res.ok) {
    if (res.status === 404 && method === "GET") {
      return null;
    }
    const text = await res.text();
    throw new Error(`Fly API Error (${res.status}): ${text}`);
  }
  return await res.json();
}

async function ensureFlyApp(config) {
  const app = await flyApi(config, "GET", "");
  if (!app) {
    const res = await fetch("https://api.machines.dev/v1/apps", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ app_name: config.appName, org_slug: "personal" }),
    });
    if (!res.ok) {
      throw new Error("Failed to create Fly app: " + (await res.text()));
    }
  }
}

async function provisionFlyMachine(config, userId) {
  await ensureFlyApp(config);

  const volName = `vol_${userId}`;
  const machineName = `workspace-${userId}`;

  const volumes = (await flyApi(config, "GET", "/volumes")) || [];
  let vol = volumes.find((v) => v.name === volName);

  if (!vol) {
    vol = await flyApi(config, "POST", "/volumes", {
      name: volName,
      region: config.region,
      size_gb: 1,
    });
  }

  const machines = (await flyApi(config, "GET", "/machines")) || [];
  let machine = machines.find((m) => m.name === machineName);
  let gatewayToken = "";

  if (machine) {
    gatewayToken = machine.config.env.OPENCLAW_GATEWAY_TOKEN;
    if (machine.state !== "started" && machine.state !== "starting") {
      await flyApi(config, "POST", `/machines/${machine.id}/start`);
    }
  } else {
    gatewayToken = crypto.randomBytes(16).toString("hex");
    machine = await flyApi(config, "POST", "/machines", {
      name: machineName,
      region: config.region,
      config: {
        image: config.image,
        env: {
          OPENCLAW_GATEWAY_TOKEN: gatewayToken,
          OPENCLAW_WORKSPACE_DIR: "/home/node/.openclaw/workspace",
        },
        mounts: [{ volume: vol.id, path: "/home/node/.openclaw/workspace" }],
        services: [
          {
            protocol: "tcp",
            internal_port: 18789,
            ports: [
              { port: 443, handlers: ["tls", "http"] },
              { port: 80, handlers: ["http"] },
            ],
            autostart: true,
            autostop: "suspend",
            min_machines_running: 0,
          },
        ],
        processes: [
          {
            name: "app",
            entrypoint: [
              "node",
              "dist/index.js",
              "gateway",
              "--bind",
              "0.0.0.0",
              "--port",
              "18789",
            ],
          },
        ],
      },
    });
  }

  return { machineId: machine.id, token: gatewayToken };
}

const BIND = process.env.AUTH_PORTAL_BIND?.trim() || "127.0.0.1";
const PORT = Number.parseInt(process.env.AUTH_PORTAL_PORT?.trim() || "18790", 10);
const SUPABASE_URL =
  process.env.SUPABASE_URL?.trim() ||
  process.env.SUPABASE_API_URL?.trim() ||
  process.env.SUPABASE_HOST?.trim() ||
  "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY?.trim() || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
const GATEWAY_TOKEN_FILE =
  process.env.OPENCLAW_GATEWAY_TOKEN_FILE?.trim() ||
  process.env.AUTH_PORTAL_GATEWAY_TOKEN_FILE?.trim() ||
  "/home/aditya/.openclaw/gateway.token";

const DEFAULT_ALLOWED_RETURN_ORIGINS = ["https://chat.mbodi.ai"];

function parseCsv(raw) {
  if (typeof raw !== "string") {
    return [];
  }
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

const ALLOWED_RETURN_ORIGINS = new Set(
  [
    ...DEFAULT_ALLOWED_RETURN_ORIGINS,
    ...parseCsv(process.env.AUTH_PORTAL_ALLOWED_RETURN_ORIGINS),
  ].map((v) => v.trim()),
);

const ALLOW_EMAILS = new Set(
  parseCsv(process.env.AUTH_PORTAL_ALLOW_EMAILS).map((v) => v.toLowerCase()),
);

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function writeResponse(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

function writeJson(res, status, payload) {
  writeResponse(
    res,
    status,
    {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
    },
    JSON.stringify(payload),
  );
}

function safeOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function resolveReturnTo(raw) {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (trimmed) {
    const origin = safeOrigin(trimmed);
    if (origin && ALLOWED_RETURN_ORIGINS.has(origin)) {
      return trimmed;
    }
  }
  return `${DEFAULT_ALLOWED_RETURN_ORIGINS[0]}/`;
}

function buildLoginHtml({ returnTo }) {
  const supabaseOrigin = safeOrigin(SUPABASE_URL);
  const connectSrc = ["'self'"];
  if (supabaseOrigin) {
    connectSrc.push(supabaseOrigin);
  }

  const csp = [
    "default-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline'",
    `connect-src ${connectSrc.join(" ")}`,
  ].join("; ");

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenClaw Auth</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        background: #0b0f14;
        color: #e6edf3;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
      }
      main {
        max-width: 420px;
        margin: 8vh auto;
        padding: 24px;
        border: 1px solid #1f2a37;
        border-radius: 12px;
        background: #0f1720;
      }
      h1 { margin: 0 0 8px; font-size: 18px; }
      p { margin: 0 0 16px; color: #9fb1c5; font-size: 13px; line-height: 1.35; }
      label { display: block; margin: 12px 0; font-size: 12px; color: #9fb1c5; }
      input {
        display: block;
        width: 100%;
        margin-top: 6px;
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid #1f2a37;
        background: #0b0f14;
        color: #e6edf3;
      }
      button {
        width: 100%;
        margin-top: 12px;
        padding: 10px 12px;
        border-radius: 10px;
        border: 0;
        background: #d946ef;
        color: #0b0f14;
        font-weight: 700;
        cursor: pointer;
      }
      button[disabled] { opacity: 0.6; cursor: not-allowed; }
      .error {
        margin-top: 12px;
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid #3b0a1a;
        background: #240712;
        color: #ff9aa8;
        font-size: 12px;
        display: none;
        white-space: pre-wrap;
      }
      .note {
        margin-top: 12px;
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid #143044;
        background: #071a26;
        color: #b8e3ff;
        font-size: 12px;
        display: none;
        white-space: pre-wrap;
      }
      .meta { margin-top: 14px; font-size: 11px; color: #6b7f95; }
      code { color: #c9d7e3; }
    </style>
  </head>
  <body>
    <main>
      <h1>Sign in</h1>
      <p>We’ll email you a sign-in link, then you’ll be redirected back to Control UI.</p>

      <form id="form">
        <label>
          Email
          <input id="email" type="email" autocomplete="username" required />
        </label>
        <button id="submit" type="submit">Send sign-in link</button>
        <div id="error" class="error"></div>
        <div id="note" class="note"></div>
      </form>

      <div class="meta">
        Return to: <code>${escapeHtml(returnTo)}</code>
      </div>
    </main>

    <script>
      (() => {
        const SUPABASE_URL = ${JSON.stringify(SUPABASE_URL)};
        const SUPABASE_ANON_KEY = ${JSON.stringify(SUPABASE_ANON_KEY)};
        const RETURN_TO = ${JSON.stringify(returnTo)};
        const AUTH_CALLBACK = ${JSON.stringify("/auth/callback")};

        const form = document.getElementById("form");
        const emailEl = document.getElementById("email");
        const submitEl = document.getElementById("submit");
        const errorEl = document.getElementById("error");
        const noteEl = document.getElementById("note");

        const STORAGE_KEY = "openclaw.auth.returnTo";

        function setError(message) {
          if (!message) {
            errorEl.style.display = "none";
            errorEl.textContent = "";
            return;
          }
          noteEl.style.display = "none";
          noteEl.textContent = "";
          errorEl.style.display = "block";
          errorEl.textContent = message;
        }

        function setNote(message) {
          if (!message) {
            noteEl.style.display = "none";
            noteEl.textContent = "";
            return;
          }
          errorEl.style.display = "none";
          errorEl.textContent = "";
          noteEl.style.display = "block";
          noteEl.textContent = message;
        }

        function callbackUrl() {
          const url = new URL(AUTH_CALLBACK, window.location.origin);
          return url.toString();
        }

        async function requestMagicLink(email) {
          const base = SUPABASE_URL.replace(/\\/+$/, "");
          const url = new URL(base + "/auth/v1/otp");
          url.searchParams.set("redirect_to", callbackUrl());
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "apikey": SUPABASE_ANON_KEY,
              "authorization": "Bearer " + SUPABASE_ANON_KEY
            },
            body: JSON.stringify({ email, create_user: true })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(
              data.error_description || data.msg || data.error || ("Failed to send link (" + res.status + ")"),
            );
          }
        }

        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          setError("");
          setNote("");

          const email = (emailEl.value || "").trim();
          if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
            setError("Auth portal is missing SUPABASE_URL / SUPABASE_ANON_KEY.");
            return;
          }
          if (!email) {
            setError("Email is required.");
            return;
          }

          submitEl.disabled = true;
          submitEl.textContent = "Sending…";
          try {
            localStorage.setItem(STORAGE_KEY, RETURN_TO);
            await requestMagicLink(email);
            setNote("Check your email for the sign-in link, then open it to finish signing in.");
          } catch (err) {
            setError(String(err && err.message ? err.message : err));
          } finally {
            submitEl.disabled = false;
            submitEl.textContent = "Send sign-in link";
          }
        });
      })();
    </script>
  </body>
</html>`;

  return { html, csp };
}

function buildCallbackHtml() {
  const allowedOrigins = [...ALLOWED_RETURN_ORIGINS];
  const defaultReturnTo = `${DEFAULT_ALLOWED_RETURN_ORIGINS[0]}/`;

  const csp = [
    "default-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
    "img-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
  ].join("; ");

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenClaw Auth</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        background: #0b0f14;
        color: #e6edf3;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial,
          "Apple Color Emoji", "Segoe UI Emoji";
      }
      main { max-width: 420px; margin: 0 auto; padding: 40px 16px; }
      h1 { font-size: 20px; margin: 0 0 8px; }
      .status { margin-top: 10px; color: #c9d7e3; font-size: 13px; }
      .error {
        margin-top: 12px;
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid #3b0a1a;
        background: #240712;
        color: #ff9aa8;
        font-size: 12px;
        white-space: pre-wrap;
        display: none;
      }
      code { color: #c9d7e3; }
    </style>
  </head>
  <body>
    <main>
      <h1>Signing in…</h1>
      <div class="status" id="status">Exchanging session for a gateway token.</div>
      <div class="error" id="error"></div>
    </main>

    <script>
      (() => {
        const STORAGE_KEY = "openclaw.auth.returnTo";
        const DEFAULT_RETURN_TO = ${JSON.stringify(defaultReturnTo)};
        const ALLOWED_ORIGINS = ${JSON.stringify(allowedOrigins)};

        const statusEl = document.getElementById("status");
        const errorEl = document.getElementById("error");

        function setError(message) {
          errorEl.style.display = "block";
          errorEl.textContent = message;
          statusEl.textContent = "Could not complete sign-in.";
        }

        function safeOrigin(url) {
          try {
            return new URL(url).origin;
          } catch {
            return null;
          }
        }

        function resolveReturnTo() {
          const fromStorage = localStorage.getItem(STORAGE_KEY);
          if (fromStorage) {
            localStorage.removeItem(STORAGE_KEY);
            const origin = safeOrigin(fromStorage);
            if (origin && ALLOWED_ORIGINS.includes(origin)) {
              return fromStorage;
            }
          }
          return DEFAULT_RETURN_TO;
        }

        function accessTokenFromUrl() {
          const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
          const hashParams = new URLSearchParams(hash);
          const searchParams = new URLSearchParams(window.location.search);

          const error =
            hashParams.get("error_description") ||
            searchParams.get("error_description") ||
            hashParams.get("error") ||
            searchParams.get("error");
          if (error) {
            return { error };
          }

          const accessToken =
            hashParams.get("access_token") ||
            searchParams.get("access_token") ||
            hashParams.get("accessToken") ||
            searchParams.get("accessToken") ||
            "";

          return { accessToken: accessToken.trim() };
        }

        async function exchange(accessToken) {
          const res = await fetch("/api/gateway-token", {
            method: "POST",
            headers: { authorization: "Bearer " + accessToken }
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(data.error || ("Token exchange failed (" + res.status + ")"));
          }
          if (!data.token) {
            throw new Error("Token exchange succeeded but no token was returned.");
          }
          return data;
        }

        async function run() {
          const { accessToken, error } = accessTokenFromUrl();
          if (error) {
            setError(String(error));
            return;
          }
          if (!accessToken) {
            setError(
              "Missing access_token from Supabase callback. " +
                "Check Supabase Auth settings: add " +
                window.location.origin +
                "/auth/callback as an allowed redirect URL, then request a new sign-in link."
            );
            return;
          }

          // Strip Supabase tokens from the URL ASAP.
          window.history.replaceState({}, "", window.location.pathname);

          let exchangeData;
          try {
            exchangeData = await exchange(accessToken);
          } catch (err) {
            setError(String(err && err.message ? err.message : err));
            return;
          }

          const dest = new URL(resolveReturnTo());
          const hash = new URLSearchParams(dest.hash.startsWith("#") ? dest.hash.slice(1) : "");
          hash.set("token", exchangeData.token);
          if (exchangeData.gatewayUrl) { hash.set("gatewayUrl", exchangeData.gatewayUrl); }
          dest.hash = "#" + hash.toString();
          window.location.replace(dest.toString());
        }

        void run();
      })();
    </script>
  </body>
</html>`;

  return { html, csp };
}

async function getSupabaseUser(accessToken) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return {
      ok: false,
      status: 500,
      error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured.",
    };
  }
  const base = SUPABASE_URL.replace(/\/+$/, "");
  const res = await fetch(`${base}/auth/v1/user`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${accessToken}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
    },
  });
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: "Supabase auth failed.",
    };
  }
  const user = await res.json();
  return { ok: true, user };
}

function extractEmail(user) {
  if (user && typeof user.email === "string") {
    return user.email;
  }
  if (user && typeof user.user === "object" && user.user && typeof user.user.email === "string") {
    return user.user.email;
  }
  return null;
}

async function readGatewayToken() {
  const token = (await fs.readFile(GATEWAY_TOKEN_FILE, "utf8")).trim();
  if (!token) {
    throw new Error("Gateway token file is empty.");
  }
  return token;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (req.method === "GET" && url.pathname === "/health") {
      writeResponse(res, 200, { "content-type": "text/plain; charset=utf-8" }, "ok\n");
      return;
    }

    if (req.method === "GET" && url.pathname === "/") {
      const returnTo = resolveReturnTo(url.searchParams.get("returnTo"));
      const { html, csp } = buildLoginHtml({ returnTo });
      writeResponse(
        res,
        200,
        {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
          "x-frame-options": "DENY",
          "content-security-policy": csp,
        },
        html,
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/auth/callback") {
      const { html, csp } = buildCallbackHtml();
      writeResponse(
        res,
        200,
        {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
          "x-frame-options": "DENY",
          "content-security-policy": csp,
        },
        html,
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/gateway-token") {
      const header = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
      const match = /^Bearer\\s+(.+)$/i.exec(header.trim());
      if (!match) {
        writeJson(res, 401, { error: "Missing Authorization: Bearer <access_token>" });
        return;
      }
      const accessToken = match[1].trim();
      const userRes = await getSupabaseUser(accessToken);
      if (!userRes.ok) {
        const status = userRes.status === 401 || userRes.status === 403 ? 401 : 502;
        writeJson(res, status, { error: status === 401 ? "Unauthorized" : userRes.error });
        return;
      }
      const emailRaw = extractEmail(userRes.user);
      const email = emailRaw?.trim().toLowerCase() ?? null;
      if (!email) {
        writeJson(res, 401, { error: "Could not resolve user email from Supabase token." });
        return;
      }
      if (ALLOW_EMAILS.size > 0 && !ALLOW_EMAILS.has(email)) {
        writeJson(res, 403, { error: "User is not allowed." });
        return;
      }

      let token = "";
      let gatewayUrl = "";

      const flyToken = process.env.FLY_API_TOKEN?.trim();
      if (flyToken) {
        const flyConfig = {
          token: flyToken,
          appName: process.env.FLY_APP_NAME?.trim() || "openclaw-workspaces",
          region: process.env.FLY_REGION?.trim() || "iad",
          image: process.env.OPENCLAW_IMAGE?.trim() || "ghcr.io/mbodi/openclaw:latest",
        };
        const sanitizedId = userRes.user.id.replace(/-/g, "").substring(0, 16);
        const result = await provisionFlyMachine(flyConfig, sanitizedId);
        token = result.token;
        const hostHeader = req.headers.host || "api.mbodi.ai";
        const protocol = hostHeader.includes("localhost") ? "ws" : "wss";
        gatewayUrl = `${protocol}://${hostHeader}/ws/${result.machineId}`;
      } else {
        token = await readGatewayToken();
      }

      writeJson(res, 200, { token, gatewayUrl: gatewayUrl || undefined });
      return;
    }

    writeJson(res, 404, { error: "Not found" });
  } catch (err) {
    writeJson(res, 500, { error: String(err) });
  }
});

server.listen(PORT, BIND, () => {
  console.log(`[auth-portal] listening on http://${BIND}:${PORT}`);
});

server.on("upgrade", (req, socket, head) => {
  const flyToken = process.env.FLY_API_TOKEN?.trim();
  if (!flyToken) {
    socket.destroy();
    return;
  }

  const match = req.url?.match(/^\/ws\/([a-z0-9-]+)/);
  if (!match) {
    socket.destroy();
    return;
  }
  const machineId = match[1];

  const appName = process.env.FLY_APP_NAME?.trim() || "openclaw-workspaces";
  const flyProxyHost = `${appName}.fly.dev`;

  const target = tls.connect(443, flyProxyHost, () => {
    const requestLines = [
      `GET / HTTP/1.1`,
      `Host: ${flyProxyHost}`,
      `Fly-Force-Instance-Id: ${machineId}`,
      `Upgrade: websocket`,
      `Connection: Upgrade`,
    ];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const key = req.rawHeaders[i];
      const val = req.rawHeaders[i + 1];
      const lower = key.toLowerCase();
      if (lower !== "host" && lower !== "upgrade" && lower !== "connection") {
        requestLines.push(`${key}: ${val}`);
      }
    }
    requestLines.push("", "");
    target.write(requestLines.join("\r\n"));
    if (head && head.length) {
      target.write(head);
    }

    socket.pipe(target);
    target.pipe(socket);
  });

  target.on("error", (err) => {
    console.error("[Fly Proxy Error]", err.message);
    socket.destroy();
  });
  socket.on("error", () => target.destroy());
});
