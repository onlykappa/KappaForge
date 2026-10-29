// Trusted test harness records source identity; visual capture itself never executes commands.
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
module.exports=function(root){
 const git=(...args)=>execFileSync('git',args,{cwd:root,maxBuffer:20000000});
 const candidate=git('rev-parse','HEAD').toString().trim(),tree=git('rev-parse','HEAD^{tree}').toString().trim();
 const untracked=git('ls-files','--others','--exclude-standard').toString().trim(),diff=git('diff','--binary','HEAD');
 return {candidate,tree,dirty:diff.length>0||!!untracked,trackedDiffSha256:createHash('sha256').update(diff).digest('hex'),
  identityScope:'Tracked tree and diff; a dirty workspace is not exact-commit validation',untracked:untracked?untracked.split('\n'):[]};
};
