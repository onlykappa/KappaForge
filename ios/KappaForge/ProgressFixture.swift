// Deterministic UI-test data. Only compiled into Debug simulator builds, never an iPhone release.
#if DEBUG && targetEnvironment(simulator)
import Foundation
import WebKit

enum ProgressFixture {
    static func script() -> WKUserScript? {
        guard let scenario = ProcessInfo.processInfo.environment["KAPPA_PROGRESS_FIXTURE"],
              ["queued", "running", "failed", "testing", "ready", "recovery"].contains(scenario) else { return nil }
        let source = #"""
        (() => {
          if (typeof KappaProgress === 'undefined' || typeof ensureTaskCard !== 'function') return;
          const scenario = '\#(scenario)', now = Date.now(), began = now - 90000;
          // This fixture enters the real persisted task model and the production renderer.
          // No network task, model call, authorization or repository mutation is performed.
          backend = ''; access = '';
          // UI fixtures do not poll an unrelated live GitHub issue with the same number.
          checkJobResult = async () => {};
          jobPollAfter = Number.MAX_SAFE_INTEGER;
          if (scenario === 'recovery') {
            backend='https://fixture.invalid';access='simulator-only';
            // Intercept the real authorization + retry HTTP boundary. Reject all
            // destinations other than this isolated fake origin; never use keys.
            globalThis.fetch=async(url,options)=>{
              if(!String(url).startsWith('https://fixture.invalid/'))throw Error('Live network forbidden in simulator fixture');
              const body=JSON.parse(options.body),path=new URL(url).pathname;
              if(path==='/operation-capabilities')return Response.json({contract:KappaIntent.capabilities.contract,rollout:{mode:'active',percent:100}});
              if(path==='/authorize'&&body.path==='/retry'&&body.payload.task===103)return Response.json({authorized:true});
              if(path==='/retry'&&body.task===103&&body.authorization?.id){
                const count=Number(localStorage.getItem('simulator.retry.count')||0)+1;
                localStorage.setItem('simulator.retry.count',String(count));
                const proof=document.createElement('p');proof.textContent='Fixture retry transport '+count;proof.style.cssText='position:fixed;top:100px;right:8px;z-index:9999';document.body.append(proof);
                return Response.json({status:'recovery_requested',task:103,message:'Recovery requested for existing task #103; no runner confirmed.'},{status:202});
              }
              throw Error('Unexpected fixture operation');
            };
            const saved = trackedJobs.find(j=>j.number===103&&j.progress?.attemptId==='simulator-recovery');
            const chat = (saved&&chats.find(c=>c.id===saved.chatId))||{id:'simulator-recovery',title:'Recovery simulator task',at:now,messages:[]};
            if (!chats.includes(chat)) chats.unshift(chat);
            current=chat.id;view='chat';
            const progress = saved?.progress||KappaProgress.normalize({version:1,taskId:'103',attemptId:'simulator-recovery',attemptAt:now,
              revision:1,status:'waiting',updatedAt:now,startedAt:now,steps:[],recovery:{candidate:'b'.repeat(40),
              nextAt:now+3600000,expiresAt:now+7200000,scanIntervalSeconds:300,continuations:0,
              last:{error:'Fixture upstream HTTP 503; no inference was sent',next:'Resume the saved candidate'}}},103);
            const job = saved||{number:103,chatId:chat.id,title:'Recovery simulator task',mode:'develop',message:'progress',queuedAt:now,activeAt:now,progress};
            trackedJobs=trackedJobs.filter(j=>j.number!==103);trackedJobs.push(job);
            ensureTaskCard(job);persistJobs();save();render();
            if (progress.recovery.nextAt>now) {
              const advance=document.createElement('button');advance.textContent='Simulate cooldown elapsed';
              advance.style.cssText='position:fixed;top:100px;right:8px;z-index:9999';
              advance.onclick=()=>{advance.remove();job.progress.recovery.nextAt=Date.now()-59000;persistJobs();save();render()};
              document.body.append(advance);
            }
            document.activeElement?.blur();scrollTo(0,0);return;
          }
          const chat = {id:'simulator-progress-'+scenario,title:'Simulator task progress',at:now,messages:[]};
          chats.unshift(chat); current = chat.id; view = 'chat';
          const failed = scenario === 'failed', validating = scenario === 'testing' || scenario === 'ready';
          // After the draft PR: every checklist step is done and the task waits on (or has passed) its own tests.
          const finished = [
            {id:'read',title:'Reading project files',detail:'12 fixture files analyzed',status:'completed',startedAt:began,finishedAt:began+24000},
            {id:'identify',title:'Identifying issues',detail:'2 fixture cases confirmed',status:'completed',startedAt:began+24000,finishedAt:began+36000},
            {id:'implement',title:'Implementing fixes',detail:'4 fixture files changed',status:'completed',startedAt:began+36000,finishedAt:began+80000},
            {id:'draft',title:'Opened draft PR #104',status:'completed',startedAt:began+80000,finishedAt:began+84000}
          ];
          const steps = validating ? finished : [
            {id:'read',title:'Reading project files',detail:'12 fixture files analyzed',status:'completed',startedAt:began,finishedAt:began+24000},
            {id:'identify',title:'Identifying issues',detail:'2 fixture cases confirmed',status:'completed',startedAt:began+24000,finishedAt:began+36000},
            {id:'implement',title:'Implementing fixes',detail:failed?'Fixture validation failed':'Adding task recovery coverage',status:failed?'failed':'running',startedAt:began+36000,finishedAt:failed?now:0},
            ...(!failed?[
              {id:'tests',title:'Running regression tests',status:'queued'},
              {id:'native',title:'Verifying iOS build',status:'queued'},
              {id:'draft',title:'Updating draft PR',status:'queued'}
            ]:[])
          ];
          const progress = scenario === 'queued' ? KappaProgress.queued(103,now-3000) : KappaProgress.normalize({
            version:1,taskId:'103',attemptId:'simulator-fixture',attemptAt:began,revision:2,
            status:failed?'failed':scenario==='testing'?'testing':scenario==='ready'?'completed':'running',updatedAt:now,startedAt:began,finishedAt:failed||validating?began+84000:0,
            steps,units:failed||validating?null:{done:1,total:3,label:'implementation stages'},findings:[
              {level:'high',text:'Fixture: JSON recovery case',resolved:true},
              {level:'medium',text:'Fixture: reconnect coverage',resolved:false}
            ]
          },103);
          const job = {number:103,chatId:chat.id,title:'Task progress (test data)',mode:'develop',message:scenario==='ready'?'tests-passed':'progress',
            prUrl:validating?'https://github.com/onlykappa/KappaForge/pull/104':'',
            queuedAt:scenario==='queued'?now-3000:began-3000,activeAt:now,progress};
          if (scenario === 'ready') {
            const sha='a'.repeat(40);
            job.candidate={sha,at:now,incomplete:false};
            job.validationReports={sandbox:{sha,conclusion:'success',workComplete:true,runId:1},native:{sha,conclusion:'success',runId:2}};
            job.validationRuns=[['Sandbox validation','sandbox-tests.yml'],['iOS build','ios-build.yml']].map(([title,file],index)=>KappaActions.normalizeRun({id:index+1,path:'.github/workflows/'+file,display_title:title+' kappa/dev-103 @ '+sha,status:'completed',conclusion:'success'}));
            job.validationObservedAt=now;
            updateTaskVerification(job);
          }
          trackedJobs = trackedJobs.filter(j=>j.number!==103); trackedJobs.push(job);
          ensureTaskCard(job); persistJobs(); save(); render();
          document.activeElement?.blur(); scrollTo(0,0);
        })();
        """#
        return WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
    }
}
#endif
