"""Owner-authorized, bounded progress polling for task #282; never merges the output PR."""
import json
import re
import subprocess
import time

REPO='onlykappa/KappaForge'
MARKER='KAPPA_TASK282_MONITOR_V1'
MAX_DISPATCHES=3


def decide(head, engine, prior, active, ready=False):
    key=head+':'+engine
    if ready:
        return 'complete',key
    if active:
        return 'running',key
    if prior.get('attemptedKey')==key:
        return 'unchanged',key
    if prior.get('dispatches',0)>=MAX_DISPATCHES:
        return 'needs_review',key
    return 'dispatch',key


def api(path, method='GET', payload=None):
    cmd=['gh','api',f'repos/{REPO}/'+path,'--method',method]
    if payload is not None:
        cmd+=['--input','-']
    result=subprocess.run(cmd,input=json.dumps(payload) if payload is not None else None,
                          capture_output=True,text=True,timeout=40)
    if result.returncode:
        raise RuntimeError('GitHub monitor request failed: '+method+' '+path.split('?')[0])
    return json.loads(result.stdout) if result.stdout.strip() else {}


def main():
    issue=api('issues/282')
    pr=api('pulls/284')
    if issue.get('state')!='open' or pr.get('state')!='open' or pr.get('draft') is not True:
        print('Stopped: task closed or output PR is no longer an open draft')
        return
    comments=[]
    for page in range(1,21):
        batch=api(f'issues/282/comments?per_page=100&page={page}')
        comments+=batch
        if len(batch)<100:break
    else:raise RuntimeError('Comment inspection limit reached')
    prior={};comment_id=None;task={}
    for comment in comments:
        if (comment.get('user') or {}).get('login')!='github-actions[bot]':continue
        body=comment.get('body','')
        for marker in (MARKER,'KAPPA_RECOVERY_V1'):
            match=re.search(r'<!-- '+marker+r' (.*?) -->',body,re.S)
            if match:
                data=json.loads(match.group(1))
                if marker==MARKER:prior=data;comment_id=comment['id']
                else:task=data
    if task.get('task')!=282 or task.get('repo')!=REPO:
        raise RuntimeError('Missing task-bound recovery checkpoint')
    # A complete workflow page is required: never dispatch when inspection may
    # have omitted an active task run. Concurrency also serializes monitor ticks.
    runs=[]
    for status in ('queued','in_progress','waiting','requested','pending'):
        batch=api('actions/workflows/agent.yml/runs?event=workflow_dispatch&status='+status+'&per_page=100')['workflow_runs']
        if len(batch)>=100:raise RuntimeError('Active run inspection window full; manual review required')
        runs+=batch
    relevant=[run for run in runs if re.match(r'^Agent task #282(?: |$)',run.get('display_title',''))]
    active=any(run.get('status')!='completed' for run in relevant)
    head=pr['head']['sha'];engine=api('git/ref/heads/main')['object']['sha']
    action,key=decide(head,engine,prior,active,task.get('status')=='ready')
    state=dict(prior,lastHead=head,lastEngine=engine,lastAction=action)
    if active:
        state['attemptedKey']=key  # An already running owner dispatch counts as this attempt.
    if action=='dispatch':
        # Debit durably before dispatch, so a timeout cannot recreate a request.
        state.update(attemptedKey=key,dispatches=prior.get('dispatches',0)+1)
    fingerprint=(head,engine,action)
    if tuple(prior.get('reported',()))==fingerprint and action!='dispatch':
        print('No new progress; no dispatch or comment update')
        return
    state.update(reported=fingerprint,updatedAt=int(time.time()))
    summary={'running':'Task is running; no overlapping retry.', 'unchanged':'No candidate or engine change; identical retry suppressed.',
             'needs_review':'Three scheduled attempts reached; further repair review required.', 'complete':'Controller reports ready; draft retained for review.',
             'dispatch':'A candidate or engine change permits one bounded retry.'}[action]
    def persist():
        nonlocal comment_id
        payload={'body':'### Task #282 progress monitor\n\n'+summary+'\n\nCandidate: `'+head+'`\n\n<!-- '+MARKER+' '+json.dumps(state,separators=(',',':'))+' -->'}
        if comment_id:api(f'issues/comments/{comment_id}','PATCH',payload)
        else:comment_id=api('issues/282/comments','POST',payload)['id']
    persist()
    if action=='dispatch':
        api('actions/workflows/agent.yml/dispatches','POST',{'ref':'main','inputs':{'issue_number':'282','action':'fix'}})
    print(summary)

if __name__=='__main__':main()
