#!/usr/bin/env node
import fs from "node:fs/promises";
import http from "node:http";
import process from "node:process";

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
      .meta { margin-top: 14px; font-size: 11px; color: #6b7f95; }
      code { color: #c9d7e3; }
    </style>
  </head>
  <body>
    <main>
      <h1>Sign in</h1>
      <p>Sign in to fetch a gateway token, then you’ll be redirected back to Control UI.</p>

      <form id="form">
        <label>
          Email
          <input id="email" type="email" autocomplete="username" required />
        </label>
        <label>
          Password
          <input id="password" type="password" autocomplete="current-password" required />
        </label>
        <button id="submit" type="submit">Sign in</button>
        <div id="error" class="error"></div>
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

        const form = document.getElementById("form");
        const emailEl = document.getElementById("email");
        const passEl = document.getElementById("password");
        const submitEl = document.getElementById("submit");
        const errorEl = document.getElementById("error");

        function setError(message) {
          if (!message) {
            errorEl.style.display = "none";
            errorEl.textContent = "";
            return;
          }
          errorEl.style.display = "block";
          errorEl.textContent = message;
        }

        async function signInWithPassword(email, password) {
          const base = SUPABASE_URL.replace(/\\/+$/, "");
          const url = base + "/auth/v1/token?grant_type=password";
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "apikey": SUPABASE_ANON_KEY
            },
            body: JSON.stringify({ email, password })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(data.error_description || data.msg || ("Login failed (" + res.status + ")"));
          }
          if (!data.access_token) {
            throw new Error("Login succeeded but no access_token was returned.");
          }
          return data.access_token;
        }

        async function fetchGatewayToken(accessToken) {
          const res = await fetch("/api/gateway-token", {
            method: "POST",
            headers: { "authorization": "Bearer " + accessToken }
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(data.error || ("Token exchange failed (" + res.status + ")"));
          }
          if (!data.token) {
            throw new Error("Token exchange succeeded but no token was returned.");
          }
          return data.token;
        }

        function redirectWithToken(token) {
          const dest = new URL(RETURN_TO);
          const hash = new URLSearchParams(dest.hash.startsWith("#") ? dest.hash.slice(1) : "");
          hash.set("token", token);
          dest.hash = "#" + hash.toString();
          window.location.replace(dest.toString());
        }

        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          setError("");

          const email = (emailEl.value || "").trim();
          const password = passEl.value || "";
          if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
            setError("Auth portal is missing SUPABASE_URL / SUPABASE_ANON_KEY.");
            return;
          }
          if (!email || !password) {
            setError("Email and password are required.");
            return;
          }

          submitEl.disabled = true;
          submitEl.textContent = "Signing in…";
          try {
            const accessToken = await signInWithPassword(email, password);
            const gatewayToken = await fetchGatewayToken(accessToken);
            redirectWithToken(gatewayToken);
          } catch (err) {
            setError(String(err && err.message ? err.message : err));
          } finally {
            submitEl.disabled = false;
            submitEl.textContent = "Sign in";
          }
        });
      })();
    </script>
  </body>
</html>`;

  return { html, csp };
}

async function getSupabaseUser(accessToken) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured.");
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
    const msg = await res.text().catch(() => "");
    const hint = msg && msg.length < 400 ? ` (${msg})` : "";
    throw new Error(`Supabase auth failed (${res.status})${hint}`);
  }
  return await res.json();
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

    if (req.method === "POST" && url.pathname === "/api/gateway-token") {
      const header = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
      const match = /^Bearer\\s+(.+)$/i.exec(header.trim());
      if (!match) {
        writeJson(res, 401, { error: "Missing Authorization: Bearer <access_token>" });
        return;
      }
      const accessToken = match[1].trim();
      const user = await getSupabaseUser(accessToken);
      const emailRaw = extractEmail(user);
      const email = emailRaw?.trim().toLowerCase() ?? null;
      if (!email) {
        writeJson(res, 401, { error: "Could not resolve user email from Supabase token." });
        return;
      }
      if (ALLOW_EMAILS.size > 0 && !ALLOW_EMAILS.has(email)) {
        writeJson(res, 403, { error: "User is not allowed." });
        return;
      }
      const token = await readGatewayToken();
      writeJson(res, 200, { token });
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
