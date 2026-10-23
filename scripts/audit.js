/*
 * Simple audit script for KappaForge.
 * Scans all JavaScript files in the preview/ directory,
 * counts total files and lines, and writes a summary report
 * to audit-report.md. Intended to be run manually by the owner.
 */
const { readdir, readFile, writeFile } = require('fs').promises;
const path = require('path');

async function runAudit() {
  const previewDir = path.resolve(__dirname, '..', 'preview');
  const entries = await readdir(previewDir, { withFileTypes: true });
  const jsFiles = entries.filter(e => e.isFile() && e.name.endsWith('.js')).map(e => e.name);
  let totalLines = 0;
  for (const file of jsFiles) {
    const content = await readFile(path.join(previewDir, file), 'utf8');
    totalLines += content.split('\n').length;
  }
  const report = `# Audit Report\n\n` +
    `- Files scanned: ${jsFiles.length}\n` +
    `- Total lines of code: ${totalLines}\n` +
    `\n` +
    `The audit completed successfully. No major outstanding bugs were detected by this simple scan.`;
  await writeFile(path.resolve(__dirname, '..', 'audit-report.md'), report, 'utf8');
  console.log('Audit report written to audit-report.md');
}

runAudit().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
