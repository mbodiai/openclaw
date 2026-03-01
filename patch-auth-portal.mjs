import fs from "fs";
let content = fs.readFileSync("scripts/auth-portal.mjs", "utf8");

const flyLogic = `
import crypto from "node:crypto";
import net from "node:net";
import tls from "node:tls";

async function flyApi(config, method, path, body = null) {
  const url = \`https://api.machines.dev/v1/apps/\${config.appName}\${path}\`;
  const options = {
    method,
    headers: {
      "Authorization": \`Bearer \${config.token}\`,
      "Content-Type": "application/json"
    }
  };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(url, options);
  if (!res.ok) {
    if (res.status === 404 && method === "GET") return null;
    const text = await res.text();
    throw new Error(\`Fly API Error (\${res.status}): \${text}\`);
  }
  return await res.json();
}

async function ensureFlyApp(config) {
  const app = await flyApi(config, "GET", "");
  if (!app) {
    const res = await fetch("https://api.machines.dev/v1/apps", {
      method: "POST",
      headers: {
        "Authorization": \`Bearer \${config.token}\`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ app_name: config.appName, org_slug: "personal" })
    });
    if (!res.ok) throw new Error("Failed to create Fly app: " + await res.text());
  }
}

async function provisionFlyMachine(config, userId) {
  await ensureFlyApp(config);
  
  const volName = \`vol_\${userId}\`;
  const machineName = \`workspace-\${userId}\`;
  
  const volumes = await flyApi(config, "GET", "/volumes") || [];
  let vol = volumes.find(v => v.name === volName);
  
  if (!vol) {
    vol = await flyApi(config, "POST", "/volumes", {
      name: volName,
      region: config.region,
      size_gb: 1
    });
  }
  
  const machines = await flyApi(config, "GET", "/machines") || [];
  let machine = machines.find(m => m.name === machineName);
  let gatewayToken = "";
  
  if (machine) {
    gatewayToken = machine.config.env.OPENCLAW_GATEWAY_TOKEN;
    if (machine.state !== "started" && machine.state !== "starting") {
      await flyApi(config, "POST", \`/machines/\${machine.id}/start\`);
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
          OPENCLAW_WORKSPACE_DIR: "/home/node/.openclaw/workspace"
        },
        mounts: [
          { volume: vol.id, path: "/home/node/.openclaw/workspace" }
        ],
        services: [
          {
            protocol: "tcp",
            internal_port: 18789,
            ports: [
              { port: 443, handlers: ["tls", "http"] },
              { port: 80, handlers: ["http"] }
            ],
            autostart: true,
            autostop: "suspend",
            min_machines_running: 0
          }
        ],
        processes: [
          {
            name: "app",
            entrypoint: ["node", "dist/index.js", "gateway", "--bind", "0.0.0.0", "--port", "18789"]
          }
        ]
      }
    });
  }
  
  return { machineId: machine.id, token: gatewayToken };
}
`;

content = content.replace(
  'import process from "node:process";',
  'import process from "node:process";\n' + flyLogic,
);

// Modify callback html
content = content.replace("          if (!data.token) {", "          if (!data.token) {");
content = content.replace("return data.token;", "return data;");

content = content.replace("let gatewayToken;", "let exchangeData;");

content = content.replace(
  "gatewayToken = await exchange(accessToken);",
  "exchangeData = await exchange(accessToken);",
);

content = content.replace(
  'hash.set("token", gatewayToken);',
  'hash.set("token", exchangeData.token);\n          if (exchangeData.gatewayUrl) { hash.set("gatewayUrl", exchangeData.gatewayUrl); }',
);

// Modify API gateway-token route
const routeApiStart = "const token = await readGatewayToken();";
const newApiRoute = `
      let token = "";
      let gatewayUrl = "";
      
      const flyToken = process.env.FLY_API_TOKEN?.trim();
      if (flyToken) {
        const flyConfig = {
          token: flyToken,
          appName: process.env.FLY_APP_NAME?.trim() || "openclaw-workspaces",
          region: process.env.FLY_REGION?.trim() || "iad",
          image: process.env.OPENCLAW_IMAGE?.trim() || "ghcr.io/mbodi/openclaw:latest"
        };
        const sanitizedId = userRes.user.id.replace(/-/g, "").substring(0, 16);
        const result = await provisionFlyMachine(flyConfig, sanitizedId);
        token = result.token;
        const hostHeader = req.headers.host || "api.mbodi.ai";
        const protocol = hostHeader.includes("localhost") ? "ws" : "wss";
        gatewayUrl = \`\${protocol}://\${hostHeader}/ws/\${result.machineId}\`;
      } else {
        token = await readGatewayToken();
      }
`;

content = content.replace(routeApiStart, newApiRoute);
content = content.replace(
  "writeJson(res, 200, { token });",
  "writeJson(res, 200, { token, gatewayUrl: gatewayUrl || undefined });",
);

fs.writeFileSync("scripts/auth-portal.mjs", content);
