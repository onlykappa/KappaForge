/*
 * Script to open a draft Pull Request on GitHub.
 * It uses the GITHUB_TOKEN environment variable for authentication.
 * Run manually after committing changes: `node scripts/open-pr.js`.
 */
const https = require('https');
const { execSync } = require('child_process');

function getRepoInfo() {
  const repo = process.env.GITHUB_REPOSITORY; // owner/repo
  if (!repo) throw new Error('GITHUB_REPOSITORY env var not set');
  const [owner, repoName] = repo.split('/');
  return { owner, repo: repoName };
}

function getCurrentBranch() {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    return branch;
  } catch (e) {
    throw new Error('Unable to determine current git branch');
  }
}

function postJSON(options, data) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => (body += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
          else reject(new Error(`GitHub API error ${res.statusCode}: ${JSON.stringify(json)}`));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(data));
    req.end();
  });
}

async function createDraftPR() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN env var not set');
  const { owner, repo } = getRepoInfo();
  const head = getCurrentBranch();
  const base = 'main'; // assuming main is the default branch

  const options = {
    hostname: 'api.github.com',
    path: `/repos/${owner}/${repo}/pulls`,
    method: 'POST',
    headers: {
      'User-Agent': 'kappaforge-script',
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json'
    }
  };

  const payload = {
    title: 'Audit and Bug‑Fix Draft PR',
    head,
    base,
    body: 'This draft PR contains the full audit report and bug‑fix changes.',
    draft: true
  };

  const result = await postJSON(options, payload);
  console.log('Draft PR created:', result.html_url);
}

createDraftPR().catch(err => {
  console.error('Failed to create draft PR:', err.message);
  process.exit(1);
});
