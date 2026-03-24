#!/usr/bin/env node
import fs from "node:fs/promises";
import http from "node:http";
import process from "node:process";

const BIND = process.env.AUTH_PORTAL_BIND?.trim() || "127.0.0.1";
const PORT = Number.parseInt(process.env.AUTH_PORTAL_PORT?.trim() || "18790", 10);
const SUPABASE_URL = (
  process.env.SUPABASE_URL?.trim() ||
  process.env.SUPABASE_API_URL?.trim() ||
  process.env.SUPABASE_HOST?.trim() ||
  ""
).replace(/\/+$/, "");
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

// ── Shared styles ──────────────────────────────────────────────────────────

const SHARED_STYLES = `
:root { color-scheme: dark; }
body {
  margin: 0; background: #0b0f14; color: #e6edf3;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
}
main {
  max-width: 420px; margin: 8vh auto; padding: 24px;
  border: 1px solid #1f2a37; border-radius: 12px; background: #0f1720;
}
h1 { margin: 0 0 8px; font-size: 18px; }
p { margin: 0 0 16px; color: #9fb1c5; font-size: 13px; line-height: 1.35; }
a { color: #d946ef; text-decoration: none; }
a:hover { text-decoration: underline; }
label { display: block; margin: 12px 0; font-size: 12px; color: #9fb1c5; }
input {
  display: block; width: 100%; margin-top: 6px; padding: 10px 12px;
  border-radius: 10px; border: 1px solid #1f2a37; background: #0b0f14; color: #e6edf3;
  box-sizing: border-box;
}
button, .btn {
  display: block; width: 100%; margin-top: 12px; padding: 10px 12px;
  border-radius: 10px; border: 0; background: #d946ef; color: #0b0f14;
  font-weight: 700; cursor: pointer; font-size: 14px; text-align: center;
  box-sizing: border-box;
}
button[disabled] { opacity: 0.6; cursor: not-allowed; }
.btn-outline {
  background: transparent; border: 1px solid #1f2a37; color: #e6edf3; font-weight: 500;
}
.btn-outline:hover { border-color: #d946ef; }
.error {
  margin-top: 12px; padding: 10px 12px; border-radius: 10px;
  border: 1px solid #3b0a1a; background: #240712; color: #ff9aa8;
  font-size: 12px; display: none; white-space: pre-wrap;
}
.note {
  margin-top: 12px; padding: 10px 12px; border-radius: 10px;
  border: 1px solid #143044; background: #071a26; color: #b8e3ff;
  font-size: 12px; display: none; white-space: pre-wrap;
}
.tabs {
  display: flex; gap: 0; margin-bottom: 16px; border-bottom: 1px solid #1f2a37;
}
.tab {
  flex: 1; padding: 10px; text-align: center; font-size: 13px; font-weight: 600;
  color: #9fb1c5; cursor: pointer; border-bottom: 2px solid transparent;
  background: none; border-left: 0; border-right: 0; border-top: 0; margin: 0;
}
.tab.active { color: #d946ef; border-bottom-color: #d946ef; }
.meta { margin-top: 14px; font-size: 11px; color: #6b7f95; }
code { color: #c9d7e3; }
.links { margin-top: 16px; text-align: center; font-size: 12px; color: #6b7f95; }
.links a { margin: 0 6px; }
.divider { margin: 16px 0; text-align: center; font-size: 11px; color: #6b7f95; position: relative; }
.divider::before, .divider::after {
  content: ""; position: absolute; top: 50%; width: 40%; height: 1px; background: #1f2a37;
}
.divider::before { left: 0; }
.divider::after { right: 0; }
`;

// ── Login page ─────────────────────────────────────────────────────────────

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
  <title>Sign In – mbodi</title>
  <style>${SHARED_STYLES}</style>
  <script>
    // If we landed here with an access_token in the hash (password recovery redirect), go to /reset-password
    (() => {
      const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
      const params = new URLSearchParams(hash);
      if (params.get("access_token") && params.get("type") === "recovery") {
        window.location.replace("/reset-password" + window.location.hash);
        return;
      }
    })();
  </script>
</head>
<body>
  <main>
    <h1>Sign in</h1>

    <div class="tabs">
      <button class="tab active" data-tab="password">Password</button>
      <button class="tab" data-tab="magic">Magic Link</button>
    </div>

    <!-- Password login -->
    <form id="password-form">
      <label>Email<input id="pw-email" type="email" autocomplete="username" required /></label>
      <label>Password<input id="pw-password" type="password" autocomplete="current-password" required /></label>
      <button id="pw-submit" type="submit">Sign in</button>
    </form>

    <!-- Magic link login -->
    <form id="magic-form" style="display:none">
      <p>We'll email you a sign-in link.</p>
      <label>Email<input id="ml-email" type="email" autocomplete="username" required /></label>
      <button id="ml-submit" type="submit">Send sign-in link</button>
    </form>

    <div id="error" class="error"></div>
    <div id="note" class="note"></div>

    <div class="divider">or</div>

    <button class="btn-outline" style="display:block;width:100%;margin-top:0;padding:10px 12px;border-radius:10px;border:1px solid #1f2a37;background:transparent;color:#e6edf3;font-weight:500;cursor:pointer;font-size:14px;text-align:center" onclick="oauthLogin('github')">Continue with GitHub</button>
    <button class="btn-outline" style="display:block;width:100%;margin-top:8px;padding:10px 12px;border-radius:10px;border:1px solid #1f2a37;background:transparent;color:#e6edf3;font-weight:500;cursor:pointer;font-size:14px;text-align:center" onclick="oauthLogin('google')">Continue with Google</button>

    <div class="links">
      <a href="/signup?returnTo=${encodeURIComponent(returnTo)}">Create account</a>
      <a href="/forgot-password?returnTo=${encodeURIComponent(returnTo)}">Forgot password?</a>
    </div>

    <div class="meta">Return to: <code>${escapeHtml(returnTo)}</code></div>
  </main>

  <script>
    (() => {
      const SUPABASE_URL = ${JSON.stringify(SUPABASE_URL)};
      const SUPABASE_ANON_KEY = ${JSON.stringify(SUPABASE_ANON_KEY)};
      const RETURN_TO = ${JSON.stringify(returnTo)};
      const STORAGE_KEY = "openclaw.auth.returnTo";

      const errorEl = document.getElementById("error");
      const noteEl = document.getElementById("note");

      function setError(msg) {
        noteEl.style.display = "none";
        if (!msg) { errorEl.style.display = "none"; return; }
        errorEl.style.display = "block"; errorEl.textContent = msg;
      }
      function setNote(msg) {
        errorEl.style.display = "none";
        if (!msg) { noteEl.style.display = "none"; return; }
        noteEl.style.display = "block"; noteEl.textContent = msg;
      }

      // OAuth login
      window.oauthLogin = function(provider) {
        localStorage.setItem(STORAGE_KEY, RETURN_TO);
        const base = SUPABASE_URL;
        const redirectTo = new URL("/callback", window.location.origin).toString();
        window.location.href = base + "/auth/v1/authorize?provider=" + provider + "&redirect_to=" + encodeURIComponent(redirectTo);
      };

      // Tab switching
      const tabs = document.querySelectorAll(".tab");
      const pwForm = document.getElementById("password-form");
      const mlForm = document.getElementById("magic-form");
      tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
          tabs.forEach((t) => t.classList.remove("active"));
          tab.classList.add("active");
          setError(""); setNote("");
          if (tab.dataset.tab === "password") {
            pwForm.style.display = ""; mlForm.style.display = "none";
          } else {
            pwForm.style.display = "none"; mlForm.style.display = "";
          }
        });
      });

      // Password login
      pwForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        setError(""); setNote("");
        const email = document.getElementById("pw-email").value.trim();
        const password = document.getElementById("pw-password").value;
        const btn = document.getElementById("pw-submit");
        btn.disabled = true; btn.textContent = "Signing in…";
        try {
          const base = SUPABASE_URL;
          const res = await fetch(base + "/auth/v1/token?grant_type=password", {
            method: "POST",
            headers: { "content-type": "application/json", "apikey": SUPABASE_ANON_KEY },
            body: JSON.stringify({ email, password }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error_description || data.msg || data.error || "Login failed");
          const accessToken = data.access_token;
          if (!accessToken) throw new Error("No access token returned");
          // Exchange for gateway token
          localStorage.setItem(STORAGE_KEY, RETURN_TO);
          const exchRes = await fetch("/api/gateway-token", {
            method: "POST",
            headers: { authorization: "Bearer " + accessToken },
          });
          const exchData = await exchRes.json().catch(() => ({}));
          if (!exchRes.ok) throw new Error(exchData.error || "Token exchange failed");
          const dest = new URL(RETURN_TO);
          const hash = new URLSearchParams(dest.hash.startsWith("#") ? dest.hash.slice(1) : "");
          hash.set("token", exchData.token);
          dest.hash = "#" + hash.toString();
          window.location.replace(dest.toString());
        } catch (err) {
          setError(err.message || String(err));
        } finally {
          btn.disabled = false; btn.textContent = "Sign in";
        }
      });

      // Magic link login
      mlForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        setError(""); setNote("");
        const email = document.getElementById("ml-email").value.trim();
        const btn = document.getElementById("ml-submit");
        btn.disabled = true; btn.textContent = "Sending…";
        try {
          const base = SUPABASE_URL;
          const url = new URL(base + "/auth/v1/otp");
          url.searchParams.set("redirect_to", new URL("/callback", window.location.origin).toString());
          const res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json", "apikey": SUPABASE_ANON_KEY, "authorization": "Bearer " + SUPABASE_ANON_KEY },
            body: JSON.stringify({ email, create_user: false }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error_description || data.msg || data.error || "Failed to send link");
          localStorage.setItem(STORAGE_KEY, RETURN_TO);
          setNote("Check your email for the sign-in link.");
        } catch (err) {
          setError(err.message || String(err));
        } finally {
          btn.disabled = false; btn.textContent = "Send sign-in link";
        }
      });
    })();
  </script>
</body>
</html>`;

  return { html, csp };
}

// ── Signup page ────────────────────────────────────────────────────────────

function buildSignupHtml({ returnTo }) {
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
  <title>Sign Up – mbodi</title>
  <style>${SHARED_STYLES}</style>
</head>
<body>
  <main>
    <h1>Create account</h1>
    <form id="form">
      <label>Email<input id="email" type="email" autocomplete="username" required /></label>
      <label>Password (min 6 characters)<input id="password" type="password" autocomplete="new-password" required minlength="6" /></label>
      <button id="submit" type="submit">Sign up</button>
      <div id="error" class="error"></div>
      <div id="note" class="note"></div>
    </form>

    <div class="divider">or</div>
    <button class="btn-outline" style="display:block;width:100%;margin-top:0;padding:10px 12px;border-radius:10px;border:1px solid #1f2a37;background:transparent;color:#e6edf3;font-weight:500;cursor:pointer;font-size:14px;text-align:center" onclick="oauthSignup('github')">Continue with GitHub</button>
    <button class="btn-outline" style="display:block;width:100%;margin-top:8px;padding:10px 12px;border-radius:10px;border:1px solid #1f2a37;background:transparent;color:#e6edf3;font-weight:500;cursor:pointer;font-size:14px;text-align:center" onclick="oauthSignup('google')">Continue with Google</button>

    <div class="links">
      <a href="/?returnTo=${encodeURIComponent(returnTo)}">Already have an account? Sign in</a>
    </div>
  </main>

  <script>
    (() => {
      const SUPABASE_URL = ${JSON.stringify(SUPABASE_URL)};
      const SUPABASE_ANON_KEY = ${JSON.stringify(SUPABASE_ANON_KEY)};
      const CALLBACK_URL = new URL("/callback", window.location.origin).toString();

      window.oauthSignup = function(provider) {
        const base = SUPABASE_URL;
        window.location.href = base + "/auth/v1/authorize?provider=" + provider + "&redirect_to=" + encodeURIComponent(CALLBACK_URL);
      };
      const errorEl = document.getElementById("error");
      const noteEl = document.getElementById("note");

      function setError(msg) {
        noteEl.style.display = "none";
        if (!msg) { errorEl.style.display = "none"; return; }
        errorEl.style.display = "block"; errorEl.textContent = msg;
      }
      function setNote(msg) {
        errorEl.style.display = "none";
        if (!msg) { noteEl.style.display = "none"; return; }
        noteEl.style.display = "block"; noteEl.textContent = msg;
      }

      document.getElementById("form").addEventListener("submit", async (e) => {
        e.preventDefault();
        setError(""); setNote("");
        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value;
        const btn = document.getElementById("submit");
        btn.disabled = true; btn.textContent = "Creating account…";
        try {
          const base = SUPABASE_URL;
          const res = await fetch(base + "/auth/v1/signup", {
            method: "POST",
            headers: { "content-type": "application/json", "apikey": SUPABASE_ANON_KEY },
            body: JSON.stringify({ email, password, data: {}, gotrue_meta_security: { captcha_token: "" } }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error_description || data.msg || data.error || "Signup failed");
          if (data.confirmation_sent_at || (data.identities && data.identities.length === 0)) {
            setNote("Check your email to confirm your account, then come back and sign in.");
          } else if (data.access_token) {
            setNote("Account created! Redirecting…");
            window.location.replace("/?returnTo=" + encodeURIComponent(${JSON.stringify(returnTo)}));
          } else {
            setNote("Check your email to confirm your account.");
          }
        } catch (err) {
          setError(err.message || String(err));
        } finally {
          btn.disabled = false; btn.textContent = "Sign up";
        }
      });
    })();
  </script>
</body>
</html>`;

  return { html, csp };
}

// ── Forgot password page ───────────────────────────────────────────────────

function buildForgotPasswordHtml({ returnTo }) {
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
  <title>Reset Password – mbodi</title>
  <style>${SHARED_STYLES}</style>
</head>
<body>
  <main>
    <h1>Reset password</h1>
    <p>Enter your email and we'll send you a link to set a new password.</p>
    <form id="form">
      <label>Email<input id="email" type="email" autocomplete="username" required /></label>
      <button id="submit" type="submit">Send reset link</button>
      <div id="error" class="error"></div>
      <div id="note" class="note"></div>
    </form>
    <div class="links">
      <a href="/?returnTo=${encodeURIComponent(returnTo)}">Back to sign in</a>
    </div>
  </main>

  <script>
    (() => {
      const SUPABASE_URL = ${JSON.stringify(SUPABASE_URL)};
      const SUPABASE_ANON_KEY = ${JSON.stringify(SUPABASE_ANON_KEY)};
      const RESET_REDIRECT = new URL("/reset-password", window.location.origin).toString();
      const errorEl = document.getElementById("error");
      const noteEl = document.getElementById("note");

      function setError(msg) {
        noteEl.style.display = "none";
        if (!msg) { errorEl.style.display = "none"; return; }
        errorEl.style.display = "block"; errorEl.textContent = msg;
      }
      function setNote(msg) {
        errorEl.style.display = "none";
        if (!msg) { noteEl.style.display = "none"; return; }
        noteEl.style.display = "block"; noteEl.textContent = msg;
      }

      document.getElementById("form").addEventListener("submit", async (e) => {
        e.preventDefault();
        setError(""); setNote("");
        const email = document.getElementById("email").value.trim();
        const btn = document.getElementById("submit");
        btn.disabled = true; btn.textContent = "Sending…";
        try {
          const base = SUPABASE_URL;
          const res = await fetch(base + "/auth/v1/recover", {
            method: "POST",
            headers: { "content-type": "application/json", "apikey": SUPABASE_ANON_KEY },
            body: JSON.stringify({ email, gotrue_meta_security: { captcha_token: "" } }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error_description || data.msg || data.error || "Failed");
          setNote("Check your email for the password reset link.");
        } catch (err) {
          setError(err.message || String(err));
        } finally {
          btn.disabled = false; btn.textContent = "Send reset link";
        }
      });
    })();
  </script>
</body>
</html>`;

  return { html, csp };
}

// ── Reset password page (user lands here from email link) ──────────────────

function buildResetPasswordHtml() {
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
  <title>Set New Password – mbodi</title>
  <style>${SHARED_STYLES}</style>
</head>
<body>
  <main>
    <h1>Set new password</h1>
    <form id="form">
      <label>New password (min 6 characters)<input id="password" type="password" autocomplete="new-password" required minlength="6" /></label>
      <button id="submit" type="submit">Update password</button>
      <div id="error" class="error"></div>
      <div id="note" class="note"></div>
    </form>
  </main>

  <script>
    (() => {
      const SUPABASE_URL = ${JSON.stringify(SUPABASE_URL)};
      const SUPABASE_ANON_KEY = ${JSON.stringify(SUPABASE_ANON_KEY)};
      const errorEl = document.getElementById("error");
      const noteEl = document.getElementById("note");

      function setError(msg) {
        noteEl.style.display = "none";
        if (!msg) { errorEl.style.display = "none"; return; }
        errorEl.style.display = "block"; errorEl.textContent = msg;
      }
      function setNote(msg) {
        errorEl.style.display = "none";
        if (!msg) { noteEl.style.display = "none"; return; }
        noteEl.style.display = "block"; noteEl.textContent = msg;
      }

      // Extract access_token from URL hash (Supabase sends it in the fragment)
      function getAccessToken() {
        const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
        const params = new URLSearchParams(hash);
        return params.get("access_token") || "";
      }

      const accessToken = getAccessToken();
      if (!accessToken) {
        setError("Missing access token. Please use the link from your email.");
      }

      document.getElementById("form").addEventListener("submit", async (e) => {
        e.preventDefault();
        setError(""); setNote("");
        const password = document.getElementById("password").value;
        const btn = document.getElementById("submit");
        btn.disabled = true; btn.textContent = "Updating…";
        try {
          if (!accessToken) throw new Error("No access token — use the link from your reset email.");
          const base = SUPABASE_URL;
          const res = await fetch(base + "/auth/v1/user", {
            method: "PUT",
            headers: {
              "content-type": "application/json",
              "apikey": SUPABASE_ANON_KEY,
              "authorization": "Bearer " + accessToken,
            },
            body: JSON.stringify({ password }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error_description || data.msg || data.error || "Update failed");
          setNote("Password updated! You can now sign in.");
          setTimeout(() => { window.location.replace("/"); }, 2000);
        } catch (err) {
          setError(err.message || String(err));
        } finally {
          btn.disabled = false; btn.textContent = "Update password";
        }
      });
    })();
  </script>
</body>
</html>`;

  return { html, csp };
}

// ── Callback page (unchanged logic) ────────────────────────────────────────

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
  <title>Signing in… – mbodi</title>
  <style>${SHARED_STYLES}</style>
</head>
<body>
  <main>
    <h1>Signing in…</h1>
    <div class="status" id="status" style="margin-top:10px;color:#c9d7e3;font-size:13px;">Exchanging session for a gateway token.</div>
    <div class="error" id="error"></div>
  </main>

  <script>
    (() => {
      const STORAGE_KEY = "openclaw.auth.returnTo";
      const DEFAULT_RETURN_TO = ${JSON.stringify(defaultReturnTo)};
      const ALLOWED_ORIGINS = ${JSON.stringify(allowedOrigins)};

      const statusEl = document.getElementById("status");
      const errorEl = document.getElementById("error");

      function setError(msg) {
        errorEl.style.display = "block"; errorEl.textContent = msg;
        statusEl.textContent = "Could not complete sign-in.";
      }

      function safeOrigin(url) { try { return new URL(url).origin; } catch { return null; } }

      function resolveReturnTo() {
        const fromStorage = localStorage.getItem(STORAGE_KEY);
        if (fromStorage) {
          localStorage.removeItem(STORAGE_KEY);
          const origin = safeOrigin(fromStorage);
          if (origin && ALLOWED_ORIGINS.includes(origin)) return fromStorage;
        }
        return DEFAULT_RETURN_TO;
      }

      function accessTokenFromUrl() {
        const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
        const hashParams = new URLSearchParams(hash);
        const searchParams = new URLSearchParams(window.location.search);
        const error =
          hashParams.get("error_description") || searchParams.get("error_description") ||
          hashParams.get("error") || searchParams.get("error");
        if (error) return { error };
        const accessToken =
          hashParams.get("access_token") || searchParams.get("access_token") ||
          hashParams.get("accessToken") || searchParams.get("accessToken") || "";
        const refreshToken = hashParams.get("refresh_token") || searchParams.get("refresh_token") || ""; return { accessToken: accessToken.trim(), refreshToken: refreshToken.trim() };
      }

      async function exchange(accessToken) {
        const res = await fetch("/api/gateway-token", {
          method: "POST",
          headers: { authorization: "Bearer " + accessToken },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || ("Token exchange failed (" + res.status + ")"));
        if (!data.token) throw new Error("Token exchange succeeded but no token was returned.");
        return data.token;
      }

      async function run() {
        const { accessToken, refreshToken, error } = accessTokenFromUrl();
        if (error) { setError(String(error)); return; }
        if (!accessToken) {
          setError("Missing access_token from Supabase callback. Check Supabase Auth settings: add " +
            window.location.origin + "/callback as an allowed redirect URL.");
          return;
        }
        window.history.replaceState({}, "", window.location.pathname);
        let gatewayToken;
        try { gatewayToken = await exchange(accessToken); }
        catch (err) { setError(err.message || String(err)); return; }
        const dest = new URL(resolveReturnTo());
        const hash = new URLSearchParams(dest.hash.startsWith("#") ? dest.hash.slice(1) : "");
        hash.set("token", gatewayToken); if (accessToken) hash.set("access_token", accessToken); if (refreshToken) hash.set("refresh_token", refreshToken);
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

// ── Supabase user verification ─────────────────────────────────────────────

async function getSupabaseUser(accessToken) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return {
      ok: false,
      status: 500,
      error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured.",
    };
  }
  const base = SUPABASE_URL;
  const res = await fetch(`${base}/auth/v1/user`, {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}`, apikey: SUPABASE_SERVICE_ROLE_KEY },
  });
  if (!res.ok) {
    return { ok: false, status: res.status, error: "Supabase auth failed." };
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

// ── HTTP server ────────────────────────────────────────────────────────────

function htmlHeaders(csp) {
  return {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "content-security-policy": csp,
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "GET" && url.pathname === "/health") {
      writeResponse(res, 200, { "content-type": "text/plain; charset=utf-8" }, "ok\n");
      return;
    }

    // Login page
    if (req.method === "GET" && url.pathname === "/") {
      const returnTo = resolveReturnTo(url.searchParams.get("returnTo"));
      const { html, csp } = buildLoginHtml({ returnTo });
      writeResponse(res, 200, htmlHeaders(csp), html);
      return;
    }

    // Signup page
    if (req.method === "GET" && url.pathname === "/signup") {
      const returnTo = resolveReturnTo(url.searchParams.get("returnTo"));
      const { html, csp } = buildSignupHtml({ returnTo });
      writeResponse(res, 200, htmlHeaders(csp), html);
      return;
    }

    // Forgot password page
    if (req.method === "GET" && url.pathname === "/forgot-password") {
      const returnTo = resolveReturnTo(url.searchParams.get("returnTo"));
      const { html, csp } = buildForgotPasswordHtml({ returnTo });
      writeResponse(res, 200, htmlHeaders(csp), html);
      return;
    }

    // Reset password page (user arrives from email link)
    if (req.method === "GET" && url.pathname === "/reset-password") {
      const { html, csp } = buildResetPasswordHtml();
      writeResponse(res, 200, htmlHeaders(csp), html);
      return;
    }

    // Callback (magic link / OAuth)
    if (req.method === "GET" && url.pathname === "/callback") {
      const { html, csp } = buildCallbackHtml();
      writeResponse(res, 200, htmlHeaders(csp), html);
      return;
    }

    // Gateway token exchange
    if (req.method === "POST" && url.pathname === "/api/gateway-token") {
      const header = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
      const match = /^Bearer\s+(.+)$/i.exec(header.trim());
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
