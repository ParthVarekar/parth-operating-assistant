import http from "node:http";
import crypto from "node:crypto";
import { exec } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { initDatabase } from "../db/database.js";
import { setUserProfile } from "../db/repositories/habitRepository.js";

const CLIENT_ID = process.env.TRELLO_CLIENT_ID || "UomOc5kOvoxpgi1NFcDtu2Z835YP2irO";
const REDIRECT_URI = "http://localhost:3000/callback";
const SCOPES = [
  "read:board:trello",
  "write:board:trello",
  "read:member:trello",
  "write:member:trello",
  "read:organization:trello",
  "write:organization:trello",
  "offline_access",
].join(" ");

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function openBrowser(url: string) {
  const startCmd = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
  exec(`${startCmd} "" "${url}"`, (err) => {
    if (err) {
      console.log(`💡 Could not auto-launch browser. Please open this URL manually:\n${url}`);
    }
  });
}

function persistTokensToEnv(accessToken: string, refreshToken?: string) {
  const envPath = resolve(process.cwd(), ".env");
  try {
    let content = readFileSync(envPath, "utf-8");
    if (!content.includes("TRELLO_ACCESS_TOKEN=")) {
      content += `\nTRELLO_ACCESS_TOKEN=${accessToken}\n`;
    } else {
      content = content.replace(/TRELLO_ACCESS_TOKEN=.*/, `TRELLO_ACCESS_TOKEN=${accessToken}`);
    }

    if (refreshToken) {
      if (!content.includes("TRELLO_REFRESH_TOKEN=")) {
        content += `TRELLO_REFRESH_TOKEN=${refreshToken}\n`;
      } else {
        content = content.replace(/TRELLO_REFRESH_TOKEN=.*/, `TRELLO_REFRESH_TOKEN=${refreshToken}`);
      }
    }

    if (!content.includes("TRELLO_CLIENT_ID=")) {
      content += `TRELLO_CLIENT_ID=${CLIENT_ID}\n`;
    }

    writeFileSync(envPath, content, "utf-8");
  } catch (err) {
    console.error("⚠️ Could not write tokens to .env file:", err);
  }
}

/**
 * Initiates the PKCE OAuth 2.0 flow for Trello / Atlassian.
 */
export async function startTrelloAuth(): Promise<void> {
  initDatabase();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const authUrl =
    `https://auth.atlassian.com/authorize?` +
    `client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code` +
    `&prompt=consent` +
    `&code_challenge_method=S256` +
    `&code_challenge=${encodeURIComponent(codeChallenge)}`;

  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url ?? "/", "http://localhost:3000");

    if (reqUrl.pathname === "/callback") {
      const code = reqUrl.searchParams.get("code");
      const error = reqUrl.searchParams.get("error");

      if (error || !code) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<h1>❌ Authentication Failed</h1><p>${error ?? "No code received"}</p>`);
        server.close();
        return;
      }

      try {
        console.log("🔄 Exchanging authorization code for OAuth tokens...");
        const tokenResponse = await fetch("https://auth.atlassian.com/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grant_type: "authorization_code",
            client_id: CLIENT_ID,
            code,
            redirect_uri: REDIRECT_URI,
            code_verifier: codeVerifier,
          }),
        });

        if (!tokenResponse.ok) {
          const errText = await tokenResponse.text();
          console.error("❌ Token exchange error:", errText);
          res.writeHead(500, { "Content-Type": "text/html" });
          res.end(`<h1>❌ Token Exchange Failed</h1><p>${errText}</p>`);
          server.close();
          return;
        }

        const tokenData = (await tokenResponse.json()) as {
          access_token: string;
          refresh_token?: string;
          expires_in?: number;
          scope?: string;
        };

        // Persist to SQLite user_profile
        setUserProfile("trello_access_token", tokenData.access_token);
        if (tokenData.refresh_token) {
          setUserProfile("trello_refresh_token", tokenData.refresh_token);
        }
        setUserProfile("trello_token_updated_at", new Date().toISOString());

        // Persist to .env
        persistTokensToEnv(tokenData.access_token, tokenData.refresh_token);

        console.log("✅ Trello OAuth 2.0 connection complete! Tokens saved.");

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Trello Connected</title>
            <style>
              body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background: #0f172a; color: #f8fafc; margin: 0; }
              .card { background: #1e293b; padding: 2.5rem; border-radius: 16px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.5); max-width: 450px; }
              h1 { color: #38bdf8; margin-top: 0; }
              p { color: #cbd5e1; line-height: 1.5; }
              .badge { display: inline-block; background: #065f46; color: #34d399; padding: 6px 12px; border-radius: 9999px; font-weight: bold; margin-bottom: 1rem; }
            </style>
          </head>
          <body>
            <div class="card">
              <div class="badge">✓ Connected</div>
              <h1>Trello Connected!</h1>
              <p>Your Personal AI Operating Assistant is now authorized to sync your boards, tasks, and deadlines.</p>
              <p style="color: #64748b; font-size: 0.9rem;">You can now close this browser tab.</p>
            </div>
          </body>
          </html>
        `);

        setTimeout(() => {
          server.close();
          process.exit(0);
        }, 1500);
      } catch (exchangeErr) {
        console.error("❌ Unexpected error during token exchange:", exchangeErr);
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end(`<h1>❌ Unexpected Error</h1><p>${String(exchangeErr)}</p>`);
        server.close();
      }
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    }
  });

  server.listen(3000, () => {
    console.log("==================================================");
    console.log("🔗 Trello OAuth 2.0 PKCE Authorization");
    console.log("==================================================");
    console.log("📡 Local callback server listening at http://localhost:3000/callback");
    console.log("\n🚀 Opening browser to Atlassian authorization screen...");
    console.log(`\nIf the browser does not open automatically, visit:\n${authUrl}\n`);
    openBrowser(authUrl);
  });
}

// Run directly if invoked via CLI
if (process.argv[1]?.endsWith("trelloAuth.ts") || process.argv[1]?.endsWith("trelloAuth.js")) {
  startTrelloAuth().catch(console.error);
}
