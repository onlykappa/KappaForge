import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import worker from '../chat-backend/src/index.js';
import '../preview/core.js';
import {locationQuestion,deviceLocation,reversePlace,formatWhereAmI,locationEvidence,NO_LOCATION} from '../chat-backend/src/location.js';

// Location for any question that needs it: "where am I" is answered from the device's precise reading; "near me"
// questions give the model that reading as context. The app asks once and sends the reading with that message only.
const env={CHAT_ACCESS_TOKEN:'location-test'};
const request=body=>new Request('https://worker.test/chat',{method:'POST',headers:{Origin:'null',Authorization:'Bearer location-test','Content-Type':'application/json'},body:JSON.stringify(body)});
const here={latitude:47.658812,longitude:-117.426022,accuracy:8};
const nominatim={address:{house_number:'808',road:'West Spokane Falls Boulevard',city:'Spokane',state:'Washington',postcode:'99201',country:'United States'},display_name:'ignored'};
const sentences={
 where:['Where am I?','where am i right now','What are my coordinates?','What is my exact location?','What city am I in?','Tell me my current location','What’s my latitude and longitude?',
  'Where are we?','Where am I located?','Where am I in the world?','Where am I on the map?'],
 nearby:['What coffee shops are near me?','Find the closest gas station','How far is Seattle from my location?','What restaurants are nearby?','How far away am I from the airport?'],
 // Status questions in a task app, not places: these never ask for GPS (post-release audit).
 none:['Tell me a joke','Fix the location endpoint code','Implement a nearby search function','Will it rain today?','What is the capital of France?',
  'Where am I in the queue?','Where am I on the task list?','Where am I with the release?','where am i at with my tasks','Where are we on task 221?']};

test('the app and the Worker agree on which questions need the location, and of which kind',()=>{
 for(const [kind,list] of Object.entries(sentences))for(const text of list){
  const want=kind==='none'?null:kind;
  assert.equal(locationQuestion(text),want,'worker: '+text);
  assert.equal(KappaCore.locationQuestion(text),want,'app: '+text);
 }
 assert.equal(KappaCore.locationNeeded('Where am I?',{}),true);
 assert.equal(KappaCore.locationNeeded('Where am I?',{locationAccess:'off'}),false,'off means never asked');
 assert.equal(KappaCore.locationNeeded('Will it rain today?',{}),true,'weather with no city still asks');
 assert.equal(KappaCore.locationNeeded('Will it rain in Paris?',{}),false);
 assert.equal(KappaCore.locationNeeded('Tell me a joke',{}),false);
});

test('only a well-formed reading is used; the reply is precise and says how accurate it is',()=>{
 for(const bad of [null,[],{latitude:91,longitude:0},{latitude:'1',longitude:2},{latitude:1}])assert.equal(deviceLocation(bad),null,JSON.stringify(bad));
 assert.deepEqual(deviceLocation({...here,reduced:true,extra:'x'}),{...here,reduced:true});
 const reply=formatWhereAmI(deviceLocation(here),'808 West Spokane Falls Boulevard, Spokane, Washington, 99201, United States');
 assert.match(reply,/47\.658812, -117\.426022/);assert.match(reply,/accurate to about 8 m/);assert.match(reply,/808 West Spokane Falls Boulevard, Spokane/);
 assert.match(reply,/not saved/);
 assert.match(formatWhereAmI(deviceLocation({...here,accuracy:3200,reduced:true}),null),/Precise Location is off[\s\S]*couldn't look up the street address/);
 assert.match(locationEvidence(deviceLocation(here),'Spokane'),/latitude 47\.658812, longitude -117\.426022[\s\S]*nearest address: Spokane[\s\S]*no live maps/);
});

test('"where am I" answers from the device reading and its address, without a model and without storing it',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,init)=>{calls.push({url:new URL(url),init});return Response.json(nominatim)};
 try{
  const data=await(await worker.fetch(request({messages:[{role:'user',text:'Where am I?'}],deviceLocation:here}),env,{})).json();
  assert.match(data.reply,/^You're at \*\*47\.658812, -117\.426022\*\* \(accurate to about 8 m\)/);
  assert.match(data.reply,/808 West Spokane Falls Boulevard, Spokane, Washington, 99201, United States/);
  assert.equal(data.tool.name,'location');assert.equal(data.tool.place.includes('Spokane'),true);
  assert.equal(calls.length,1,'one reverse lookup and no model call');
  assert.equal(calls[0].url.hostname,'nominatim.openstreetmap.org');assert.equal(calls[0].url.searchParams.get('lat'),'47.65881');
  assert.match(calls[0].init.headers['User-Agent'],/^KappaForge\//,'Nominatim requires an identifying user agent');
  const again=await(await worker.fetch(request({messages:[{role:'user',text:'What are my coordinates?'}],deviceLocation:here}),env,{})).json();
  assert.match(again.reply,/47\.658812/);assert.equal(calls.length,1,'a repeat within five minutes uses the cache');
  const none=await(await worker.fetch(request({messages:[{role:'user',text:'Where am I?'}]}),env,{})).json();
  assert.equal(none.reply,NO_LOCATION);assert.equal(calls.length,1);
 }finally{globalThis.fetch=original;}
});

test('a failed address lookup still gives the coordinates',async()=>{
 const place=await reversePlace(deviceLocation({latitude:1,longitude:2}),{store:new Map(),fetcher:async()=>new Response('busy',{status:503})});
 assert.equal(place,null);
 assert.match(formatWhereAmI(deviceLocation({latitude:1,longitude:2}),place),/1\.000000, 2\.000000[\s\S]*couldn't look up the street address/);
 assert.equal(await reversePlace(deviceLocation({latitude:3,longitude:4}),{store:new Map(),fetcher:async()=>{throw new DOMException('t','TimeoutError')}}),null);
});

test('"near me" questions give the model the reading as context for that message only',()=>{
 const index=readFileSync(new URL('../chat-backend/src/index.js',import.meta.url),'utf8');
 assert.match(index,/if\(locationAsked&&sharedLocation\)locationContext=locationEvidence\(/);
 assert.match(index,/\(locationContext \? "\\n\\n" \+ locationContext : ""\)/,'the context goes into this request’s system instruction');
 assert.doesNotMatch(index,/MEMORY\.put\([^)]*[Ll]ocation/,'the reading is never written to storage');
});

// The real chat submit handler from preview/app-main.js with its collaborators stubbed.
function chatHarness({text,preferences,location}){
 const main=readFileSync(new URL('../preview/app-main.js',import.meta.url),'utf8');
 const registration=main.split('\n').find(line=>line.startsWith('document.getElementById("form").addEventListener("submit"'));
 let submit;const chat={id:'one',messages:[]},sent=[],asked=[];
 const input={value:text},button={setAttribute(){},innerHTML:'',onclick:null};
 const box={sending:false,queuedAttachments:[],chats:[chat],backend:'https://worker.example',access:'fixture',trackedJobs:[],savedMemories:[],
  personality:'auto',lockedCommit:null,verificationOnly:false,TASK_INTENT:{none:'none'},preferences,
  KappaCore:{...KappaCore,deviceLocation:async()=>{asked.push(text);return location}},KappaJobs:{isSubmission:()=>false},
  document:{getElementById:id=>id==='form'?{addEventListener:(_n,fn)=>{submit=fn}}:input,querySelector:()=>button},
  refreshAttachList(){},chatCommand:()=>null,active:()=>chat,save(){},render(){},rememberFromMessage:()=>false,setActivity(){},savePreferences(){},
  chatTaskPlan:()=>({kind:'none'}),runChatAction:async()=>{},checkWorkClaims(){},logDiagnostic(){},AbortController,uiIcon:()=>'',navigator:{language:'en-US'},
  fetch:async(_u,init)=>{sent.push(JSON.parse(init.body));return {ok:true}},receiveAssistant:async(_r,c,prefix)=>{c.messages.push({role:'assistant',text:prefix+'ok'});return {reply:'ok'}}};
 vm.runInNewContext(registration,box);
 return {run:()=>submit({preventDefault(){}}),box,sent,asked};
}

test('the app asks for the precise location for location questions and sends it with that message only',async()=>{
 const where=chatHarness({text:'Where am I?',preferences:KappaCore.settings({}),location:here});
 await where.run();
 assert.deepEqual(where.sent[0].deviceLocation,here);assert.equal(where.box.preferences.locationAccess,'allowed');
 for(const text of ['Fix the location endpoint code','Tell me a joke']){
  const other=chatHarness({text,preferences:KappaCore.settings({}),location:here});
  await other.run();
  assert.deepEqual(other.asked,[],text);assert.equal('deviceLocation' in other.sent[0],false,text);
 }
 const off=chatHarness({text:'What coffee shops are near me?',preferences:KappaCore.settings({locationAccess:'off'}),location:here});
 await off.run();
 assert.deepEqual(off.asked,[]);assert.equal('deviceLocation' in off.sent[0],false);
});

test('iOS asks for best accuracy and reports the accuracy and reduced (non-precise) readings',()=>{
 const swift=readFileSync(new URL('../ios/KappaForge/LocationRequester.swift',import.meta.url),'utf8');
 assert.match(swift,/desiredAccuracy = kCLLocationAccuracyBest/);
 assert.match(swift,/"accuracy": place\.horizontalAccuracy, "reduced": manager\.accuracyAuthorization == \.reducedAccuracy/);
 assert.doesNotMatch(swift,/startUpdatingLocation|requestAlwaysAuthorization|allowsBackgroundLocationUpdates|UserDefaults/);
 assert.match(readFileSync(new URL('../ios/project.yml',import.meta.url),'utf8'),/NSLocationWhenInUseUsageDescription: Used only when you ask something that needs your location/);
});
