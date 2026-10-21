// Gemini usage as Google counts it, read from Cloud Monitoring with a service account that has Monitoring Viewer
// on the AI Studio key's project (Worker secret GOOGLE_SERVICE_ACCOUNT_JSON). The Gemini API key itself cannot read
// usage. Days start at midnight Pacific, like AI Studio. Results are cached for a minute; errors are returned as
// a reason, never a guess, and never include the credential.
const TTL_MS=60000,SCOPE="https://www.googleapis.com/auth/monitoring.read";
let tokenCache=null,usageCache=null;

const b64url=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const text=s=>new TextEncoder().encode(s);

function account(env){
 let sa;try{sa=JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON||"")}catch{throw Object.assign(Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the whole downloaded key file."),{setup:true});}
 if(sa?.type!=="service_account"||!sa.client_email||!sa.private_key||!sa.project_id)throw Object.assign(Error("GOOGLE_SERVICE_ACCOUNT_JSON is not a service account key file."),{setup:true});
 return sa;
}

async function accessToken(sa,now){
 if(tokenCache&&tokenCache.email===sa.client_email&&tokenCache.expires>now+60000)return tokenCache.token;
 const pem=sa.private_key.replace(/-----[^-]+-----/g,"").replace(/\s+/g,"");
 const der=Uint8Array.from(atob(pem),c=>c.charCodeAt(0));
 const key=await crypto.subtle.importKey("pkcs8",der,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
 const iat=Math.floor(now/1000),head=b64url(text(JSON.stringify({alg:"RS256",typ:"JWT"}))),
  claims=b64url(text(JSON.stringify({iss:sa.client_email,scope:SCOPE,aud:"https://oauth2.googleapis.com/token",iat,exp:iat+3600})));
 const jwt=head+"."+claims+"."+b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,text(head+"."+claims)));
 const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",signal:AbortSignal.timeout(8000),headers:{"Content-Type":"application/x-www-form-urlencoded"},
  body:"grant_type="+encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")+"&assertion="+jwt});
 const d=await r.json().catch(()=>({}));
 if(!r.ok||!d.access_token)throw Error("Google sign-in for the service account failed ("+(d.error_description||d.error||"HTTP "+r.status)+").");
 tokenCache={email:sa.client_email,token:d.access_token,expires:now+(Number(d.expires_in)||3600)*1000};
 return d.access_token;
}

// Midnight in Los Angeles, as a UTC timestamp.
export function pacificDayStart(now){
 const parts=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:"America/Los_Angeles",hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
 const local=Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second);
 return now-(local-Date.UTC(+parts.year,+parts.month-1,+parts.day));
}

async function series(token,project,filter,start,end,extra=""){
 const url="https://monitoring.googleapis.com/v3/projects/"+encodeURIComponent(project)+"/timeSeries?filter="+encodeURIComponent(filter)+
  "&interval.startTime="+new Date(start).toISOString()+"&interval.endTime="+new Date(end).toISOString()+extra;
 const r=await fetch(url,{headers:{Authorization:"Bearer "+token},signal:AbortSignal.timeout(10000)});
 const d=await r.json().catch(()=>({}));
 if(r.status===403)throw Error("The service account can't read Cloud Monitoring for project "+project+". Give it the Monitoring Viewer role on that project.");
 if(!r.ok)throw Error("Cloud Monitoring HTTP "+r.status+(d.error?.message?": "+String(d.error.message).slice(0,200):""));
 return d.timeSeries||[];
}
const value=p=>Number(p?.value?.int64Value??p?.value?.doubleValue??0)||0;

export async function googleUsage(env,now=Date.now()){
 if(!env.GOOGLE_SERVICE_ACCOUNT_JSON)return {configured:false};
 if(usageCache&&now-usageCache.at<TTL_MS)return usageCache.value;
 let result;
 try{
  const sa=account(env),token=await accessToken(sa,now),start=pacificDayStart(now),seconds=Math.max(60,Math.ceil((now-start)/1000));
  // Quota usage the Gemini API reports for this project today: one total per quota metric and model.
  const rows=await series(token,sa.project_id,'metric.type="serviceruntime.googleapis.com/quota/rate/net_usage" AND resource.type="consumer_quota" AND resource.label.service="generativelanguage.googleapis.com"',start,now,
   "&aggregation.alignmentPeriod="+seconds+"s&aggregation.perSeriesAligner=ALIGN_SUM");
  const usage=rows.map(s=>({quotaMetric:s.metric?.labels?.quota_metric||null,labels:{...(s.metric?.labels||{}),...(s.resource?.labels||{})},total:(s.points||[]).reduce((n,p)=>n+value(p),0)}));
  result={configured:true,project:sa.project_id,since:start,source:"google-cloud-monitoring",usage};
 }catch(error){result={configured:true,error:String(error?.message||error).slice(0,300)};}
 usageCache={at:now,value:result};
 return result;
}
