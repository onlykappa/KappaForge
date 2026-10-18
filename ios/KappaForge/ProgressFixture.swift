// Deterministic UI-test data. Only compiled into Debug simulator builds, never an iPhone release.
#if DEBUG && targetEnvironment(simulator)
import Foundation
import WebKit

enum ProgressFixture {
    static func script() -> WKUserScript? {
        guard let scenario = ProcessInfo.processInfo.environment["KAPPA_PROGRESS_FIXTURE"],
              ["queued", "running", "failed"].contains(scenario) else { return nil }
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
          const chat = {id:'simulator-progress-'+scenario,title:'Simulator task progress',at:now,messages:[]};
          chats.unshift(chat); current = chat.id; view = 'chat';
          const failed = scenario === 'failed';
          const steps = [
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
            status:failed?'failed':'running',updatedAt:now,startedAt:began,finishedAt:failed?now:0,
            steps,units:failed?null:{done:1,total:3,label:'implementation stages'},findings:[
              {level:'high',text:'Fixture: JSON recovery case',resolved:true},
              {level:'medium',text:'Fixture: reconnect coverage',resolved:false}
            ]
          },103);
          const job = {number:103,chatId:chat.id,title:'Task progress (test data)',mode:'develop',message:'progress',
            queuedAt:scenario==='queued'?now-3000:began-3000,activeAt:now,progress};
          trackedJobs = trackedJobs.filter(j=>j.number!==103); trackedJobs.push(job);
          ensureTaskCard(job); persistJobs(); save(); render();
          document.activeElement?.blur(); scrollTo(0,0);
        })();
        """#
        return WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
    }
}
#endif
