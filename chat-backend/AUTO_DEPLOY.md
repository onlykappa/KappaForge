# Automatic Cloudflare Worker deployment

KappaForge uses GitHub Actions and Wrangler to deploy the existing `kappaforge-chat` Worker.

## One-time setup

1. In Cloudflare dashboard, copy your **Account ID** from the Workers overview.
2. In Cloudflare **Profile > API Tokens**, create a custom token limited to **Account > Workers Scripts > Edit** for your own account. Do not use your Global API Key. Depending on Cloudflare settings, additional read permissions may be required; grant only what deployment actually needs.
3. In GitHub's KappaForge repository, add two **Actions repository secrets** under Settings > Secrets and variables > Actions:
   - `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare account ID
   - `CLOUDFLARE_API_TOKEN`: your restricted Cloudflare API token
4. Run **Actions > Deploy KappaForge Chat > Run workflow** once. Watch it succeed before relying on automatic deployment.
5. Subsequent changes to `chat-backend/**` pushed to `main` deploy automatically after the Worker JavaScript syntax check passes. The Worker URL remains tied to its Cloudflare account and Worker name.

**Keep the pre-existing Cloudflare encrypted Worker secrets** `GEMINI_API_KEY` and `CHAT_ACCESS_TOKEN`; the deployment workflow must never log or copy them. The first deployment should be verified carefully to confirm they remain bound to the Worker.

## Cautions

A syntax check is not a complete test. Production deploys from `main` should follow human review of sensitive backend changes. GitHub environments can require deployment approval if configured. Restrict GitHub write access and keep secrets hidden. Public pull requests should not receive deployment secrets.

This workflow does **not** configure a GitHub job-launch token (`GITHUB_JOB_TOKEN`). That separate credential requires careful permission scoping and checking the existing agent's issue-author restrictions before enabling automated coding jobs.
