# Deploy Buddha Bot on Cloudflare

This deployment serves **buddha.koanzone.net**. The existing website at **koanzone.net** stays in place. The backend stays on your Mac behind the existing **api.koanzone.net** tunnel.

## 1. Protect the website hostname

You already have the **Buddha Bot API** Access application and a **buddha-bot-website** service token accepted by its **Service Auth** policy. Keep those.

Create a second Access application for the people visiting the website:

- Cloudflare → Zero Trust → Access controls → Applications → Create new application.
- Choose Self-hosted (or Self-hosted and private), then Add public hostname.
- Name: **Buddha Bot Website**.
- Public hostname: **buddha.koanzone.net**. Leave Path blank. Do not enter a private IP or port.
- Allow policy: **Emails**, with your email address (and any invited testers).
- Enable One-time PIN or your existing login provider. Save.
- Copy this application's **Application Audience (AUD) Tag** from its details. Use the WEBSITE application's audience, not the API application's audience.
- Note your Zero Trust team domain: `your-team.cloudflareaccess.com`. It is the hostname of your Cloudflare Access login page, not `api.koanzone.net`.

The Worker verifies the visitor's signed Access token before making API requests. This prevents the website's service token from turning the frontend into an unauthenticated model proxy. Missing configuration returns 503; a missing/invalid visitor token returns 401. Alternate workers.dev and version-preview URLs are disabled.

## 2. Commit and push the deployment files

The local changes are in `/Users/jeff/Desktop/koan/buddha-bot` and have not been committed or pushed automatically. From Terminal:

```sh
cd /Users/jeff/Desktop/koan
git add buddha-bot
git diff --cached --stat
git commit -m "Prepare Buddha Bot for Cloudflare"
git push origin main
```

The project's ignore rules exclude `.env`, `.dev.vars`, installed packages, and build output. The agent never needs to see the service token secret. Do not place secrets in tracked files or variables prefixed `NEXT_PUBLIC_`.

## 3. Connect the GitHub repository to Workers

In Cloudflare → Workers & Pages, create a **Worker** using **Import a repository / Connect Git**. Select GitHub repository **koanzone/koan**.

| Setting | Value |
| --- | --- |
| Worker/project name | `buddha-bot` |
| Production branch | `main` |
| Root directory | `buddha-bot/frontend` |
| Build command | `pnpm run build:cloudflare` |
| Deploy command | `pnpm run deploy:cloudflare` |

Use the existing `wrangler.jsonc` configuration; do not select a Pages preset or run a Next.js migration. Cloudflare should install dependencies from `pnpm-lock.yaml`. Set build variables **NODE_VERSION=22** and **PNPM_VERSION=11.25.0** if needed to match this setup. These two are build settings, not API credentials.

The deployment produces static pages with the normal Next.js compiler and uploads them together with a small streaming Worker. The configuration attaches only `buddha.koanzone.net`. It does not change the root website or the API tunnel route.

On the first deployment, the website API will report unconfigured until the following secrets are added. That is expected and does not expose the model.

## 4. Add runtime secrets

Open Workers & Pages → **buddha-bot** → Settings → **Variables and Secrets**. Add each as type **Secret**:

| Name | Value |
| --- | --- |
| `CF_ACCESS_CLIENT_ID` | Client ID of the existing `buddha-bot-website` service token |
| `CF_ACCESS_CLIENT_SECRET` | Client Secret saved when creating that service token |
| `CF_ACCESS_TEAM_DOMAIN` | Your team hostname, e.g. `your-team.cloudflareaccess.com`, without `https://` or a trailing slash |
| `CF_ACCESS_AUD` | Audience tag of **Buddha Bot Website** |

Save/deploy the changes. These are Worker runtime secrets, NOT build environment variables or GitHub secrets. `BACKEND_URL=https://api.koanzone.net` is already in the configuration. Wrangler preserves deployed secrets on subsequent deployments.

## 5. Test

Keep FastAPI and cloudflared running on the Mac. Open **https://buddha.koanzone.net** in a private window. Sign in with your allowed email address. Confirm that the guide appears, the header says DEMO, and the two opening questions lead to a streamed demo reply.

The website's health endpoint is **https://buddha.koanzone.net/api/health**. It should return the backend status after login. Stop and Retry should recover without duplicating your message. Check a phone viewport too.

Use the full health path: the Python backend's root URL `/` intentionally returns Not Found.

## Troubleshooting

- **401 at website API:** sign in again; confirm the configured audience belongs to the Website application and the team hostname is correct.
- **503:** one of the four runtime settings is missing/invalid, or `BACKEND_URL` isn't an HTTPS origin. Do not add a path to BACKEND_URL.
- **502 mentioning Access:** check the service token ID/secret and the API application's **Service Auth → Include → Service Token** policy. The email Allow policy is for your browser; it does not authenticate the Worker.
- **502 mentioning Mac:** FastAPI or cloudflared is stopped, or the tunnel service URL is incorrect. Check `http://127.0.0.1:8000/api/health` locally.
- **409:** the single model worker is busy. Retry after it finishes.
- **NXDOMAIN on one network only:** compare your normal DNS lookup with `dig @1.1.1.1 buddha.koanzone.net`. The earlier api.koanzone.net issue came from the local/router resolver.
- **Custom-domain conflict:** inspect the existing `buddha` DNS record before changing it; do not delete `api` or root-domain records.

## Local development and checks

`pnpm dev` still uses the Next.js local proxy to `127.0.0.1:8000`. `pnpm build` / `pnpm start` remain available for the original local workflow. `pnpm run build:cloudflare` is a separate static-export build; use `pnpm run preview:cloudflare` to serve that build in the Workers runtime. Run `pnpm build` again before using `pnpm start` after a static-export build.

```sh
cd buddha-bot/frontend
pnpm install --frozen-lockfile
pnpm test
pnpm run build:cloudflare
pnpm exec wrangler deploy --dry-run
```

The dry run checks packaging without publishing. A local Worker preview can serve assets without credentials; its API intentionally refuses requests without a valid Access token. Tests use temporary synthetic credentials and signing keys, never the real service token. Do not disable authentication just to test the preview.

This configuration uses free-plan-compatible services, subject to Cloudflare's free-tier limits. No paid subscription is configured. Qwen remains on the Mac, and the production model path still needs a separate smoke test when you switch from demo to MLX.

References: [Workers static assets](https://developers.cloudflare.com/workers/static-assets/binding/), [Git build settings](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), [Access token validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).
