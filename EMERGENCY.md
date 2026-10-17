# If KappaForge breaks after a change

KappaForge can change its own code, so a merged change can break the app or the chat Worker. These steps undo it, from the easiest to the most manual. None of them loses chats, memory or settings: those live on your device and in the encrypted vault, not in the code.

## 1. The Worker broke right after a merge

Usually nothing to do. After every deploy, GitHub checks the Worker's `/health` page; if it fails, it rolls the Worker back to the previous version automatically. You'll see a failed **Deploy KappaForge Chat** run under GitHub → Actions with the message "rolling back to the previous version".

## 2. The app still opens: use Undo

1. Dashboard → **Tests & deployments** → **↶ Undo last change**.
2. Confirm. KappaForge opens a pull request that restores the version from before the last change.
3. Under **Code reviews**, tap **Review & merge** on the "Undo:" item, then **Merge**. Exact restores can merge straight away; they don't wait for tests.

Undo only reverts the most recent change. Repeat it to step back further.

## 3. The app won't open or chat is down: revert on GitHub

1. On github.com open **onlykappa/KappaForge → Pull requests → Closed**.
2. Open the pull request that caused the problem (the most recent merged one).
3. Click **Revert** near the bottom, then **Create pull request**, then **Merge pull request**.
4. Wait about 3 minutes for **Deploy KappaForge Chat** and **Publish KappaForge Web** to finish under Actions.

## 4. Roll the Worker back by hand

Cloudflare dashboard → Workers & Pages → **kappaforge-chat** → **Deployments** → pick the last working version → **Rollback**. This fixes chat immediately; revert the code afterwards (step 3) so the next deploy doesn't bring the problem back.

## What the agent can never change

The agent's guardrails are locked: GitHub workflows, the merge and review checks in the Worker (`chat-backend/src/review.js`), its GitHub credentials handling, the provider list, the agent engine's own safety files, and the tests that pin them. Changes to those only happen through a human-written pull request.
