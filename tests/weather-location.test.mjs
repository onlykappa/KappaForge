import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../preview/core.js';
import {weatherRequest,weatherArguments} from '../chat-backend/src/weather.js';

// Issue #111 (the #117 cleanup): the app asks for the device location once, only for a weather question that names
// no city, and sends one rounded reading with that message. Denial turns it off and asks for a city instead.
const questions=['What is the weather?',"What's the weather like?",'Will it rain today?','Will it rain tomorrow?','Is it windy?','Do I need an umbrella?','Weather in Paris?','What is the forecast for Spokane Valley tomorrow?','What is the seven-day forecast?','Implement a weather endpoint','Fix the weather unit test','Tell me a joke','How is the temperature in Berlin in Celsius?','Forecast for today?'];

test('the app and the Worker agree on what is a weather question and whether it names a city',()=>{
 for(const text of questions){
  assert.equal(KappaCore.weatherQuestion(text),weatherRequest(text),text);
  if(weatherRequest(text))assert.equal(KappaCore.weatherLocationNeeded(text,{}),!weatherArguments(text,{}).city,text);
 }
});

test('everyday weather wording is recognized, so the answer uses real data instead of a guess',()=>{
 // Post-release audit: "raining"/"snowing" missed the plain-word match and went to the model with no weather data.
 for(const text of ['Is it raining here?','Is it snowing?','Will it be rainy tomorrow?','Is it going to be windy today?','Will it storm tonight?','Is it stormy in Denver?']){
  assert.equal(weatherRequest(text),true,text);assert.equal(KappaCore.weatherQuestion(text),true,'app: '+text);
 }
 assert.equal(KappaCore.weatherLocationNeeded('Is it raining here?',{}),true,'"here" uses the device location');
 assert.equal(weatherArguments('Is it stormy in Denver?',{}).city,'Denver');
 for(const text of ['Fix the rainy-day test','What is a brainstorm?'])assert.equal(weatherRequest(text),false,text);
});

test('location is needed only for a weather question with no typed or saved city, unless turned off',()=>{
 assert.equal(KappaCore.weatherLocationNeeded('Will it rain today?',{}),true);
 assert.equal(KappaCore.weatherLocationNeeded('Will it rain today?',{locationAccess:'allowed'}),true);
 assert.equal(KappaCore.weatherLocationNeeded('Will it rain today?',{locationAccess:'off'}),false);
 assert.equal(KappaCore.weatherLocationNeeded('Will it rain today?',{weatherCity:'Paris'}),false);
 assert.equal(KappaCore.weatherLocationNeeded('Will it rain in Paris today?',{}),false);
 assert.equal(KappaCore.weatherLocationNeeded('Implement a weather endpoint',{}),false);
 assert.equal(KappaCore.weatherLocationNeeded('Tell me a joke',{}),false);
 assert.equal(KappaCore.settings({}).locationAccess,'ask');
 assert.equal(KappaCore.settings({locationAccess:'off'}).locationAccess,'off');
 assert.equal(KappaCore.settings({locationAccess:'always'}).locationAccess,'ask','unknown values fall back to asking');
});

test('browser location: one rounded reading; denial and errors are coded',async()=>{
 const calls=[];
 const geo=result=>({getCurrentPosition:(ok,fail,options)=>{calls.push(options);result(ok,fail)}});
 const place=await KappaCore.deviceLocation({native:null,geolocation:geo(ok=>ok({coords:{latitude:47.658812345,longitude:-117.426021987,accuracy:8.04}}))});
 assert.deepEqual(place,{latitude:47.658812,longitude:-117.426022,accuracy:8},'precise to about 0.1 m, with its accuracy');
 assert.equal(calls[0].enableHighAccuracy,true);assert.equal(calls[0].maximumAge,0,'never an old cached reading');
 await assert.rejects(KappaCore.deviceLocation({native:null,geolocation:geo((_ok,fail)=>fail({code:1}))}),{code:'denied'});
 await assert.rejects(KappaCore.deviceLocation({native:null,geolocation:geo((_ok,fail)=>fail({code:2}))}),{code:'unavailable'});
 await assert.rejects(KappaCore.deviceLocation({native:null,geolocation:geo(ok=>ok({coords:{latitude:120,longitude:0}}))}),{code:'unavailable'});
 await assert.rejects(KappaCore.deviceLocation({native:null,geolocation:null}),{code:'unavailable'});
 await assert.rejects(KappaCore.deviceLocation({native:null,geolocation:{getCurrentPosition(){}},timeout:20}),{code:'unavailable'},'no answer times out');
});

test('iOS location goes through the native bridge once and the callback is removed afterwards',async()=>{
 const posted=[];
 const native=event=>({postMessage:m=>{posted.push(m);queueMicrotask(()=>globalThis.KappaLocationNative(event))}});
 assert.deepEqual(await KappaCore.deviceLocation({native:native({type:'location',latitude:40.712776,longitude:-74.005974,accuracy:5,reduced:false})}),{latitude:40.712776,longitude:-74.005974,accuracy:5});
 assert.deepEqual(await KappaCore.deviceLocation({native:native({type:'location',latitude:40.7,longitude:-74,accuracy:3000,reduced:true})}),{latitude:40.7,longitude:-74,accuracy:3000,reduced:true},'approximate iOS readings say so');
 posted.length=1;
 assert.deepEqual(posted,[{action:'location'}]);assert.equal(globalThis.KappaLocationNative,undefined);
 await assert.rejects(KappaCore.deviceLocation({native:native({type:'error',code:'denied'})}),{code:'denied'});
 await assert.rejects(KappaCore.deviceLocation({native:native({type:'error',code:'unavailable'})}),{code:'unavailable'});
 assert.equal(globalThis.KappaLocationNative,undefined);
});

// The real chat submit handler from preview/app-main.js with its collaborators stubbed.
function chatHarness({text,preferences,location}){
 const main=readFileSync(new URL('../preview/app-main.js',import.meta.url),'utf8');
 const registration=main.split('\n').find(line=>line.startsWith('document.getElementById("form").addEventListener("submit"'));
 assert.ok(registration);
 let submit;const chat={id:'one',messages:[]},sent=[],activity=[],stored=[];
 const input={value:text},button={setAttribute(){},innerHTML:'',onclick:null};
 const core={...KappaCore,deviceLocation:async()=>{activity.push('location');if(location instanceof Error)throw location;return location}};
 const box={sending:false,queuedAttachments:[],chats:[chat],backend:'https://worker.example',access:'fixture',trackedJobs:[],savedMemories:[],
  personality:'auto',lockedCommit:null,verificationOnly:false,TASK_INTENT:{none:'none'},preferences,KappaCore:core,KappaJobs:{isSubmission:()=>false},
  document:{getElementById:id=>id==='form'?{addEventListener:(_name,fn)=>{submit=fn}}:input,querySelector:()=>button},
  refreshAttachList(){},chatCommand:()=>null,active:()=>chat,save(){},render(){},rememberFromMessage:()=>false,setActivity:a=>activity.push(a),
  savePreferences(){stored.push({...box.preferences})},chatTaskPlan:()=>({kind:'none'}),runChatAction:async()=>{},checkWorkClaims(){},logDiagnostic(){},
  AbortController,uiIcon:()=>'',navigator:{language:'en-US'},
  fetch:async(_url,init)=>{sent.push(JSON.parse(init.body));return {ok:true}},
  receiveAssistant:async(_r,c,prefix)=>{c.messages.push({role:'assistant',text:prefix+'Which city should I check?'});return {reply:'x'}}};
 vm.runInNewContext(registration,box);
 return {run:()=>submit({preventDefault(){}}),box,chat,sent,activity,stored};
}

test('first weather question: location is asked, sent once with that message, and "allowed" is remembered',async()=>{
 const h=chatHarness({text:'Will it rain today?',preferences:KappaCore.settings({}),location:{latitude:47.66,longitude:-117.43}});
 await h.run();
 assert.deepEqual(h.sent[0].deviceLocation,{latitude:47.66,longitude:-117.43});
 assert.ok(h.activity.includes('location'));
 assert.equal(h.box.preferences.locationAccess,'allowed');
 assert.ok(h.stored.every(p=>!('latitude' in p)&&!JSON.stringify(p).includes('47.66')),'coordinates are never saved with preferences');
 assert.equal(h.chat.messages.some(m=>m.text.includes('47.66')),false,'coordinates are not written into the chat');
});

test('permission denied: no location is sent, the setting turns off, and the reply says so and asks for a city',async()=>{
 const denied=Object.assign(Error('Location permission denied'),{code:'denied'});
 const h=chatHarness({text:'Will it rain today?',preferences:KappaCore.settings({}),location:denied});
 await h.run();
 assert.equal('deviceLocation' in h.sent[0],false);
 assert.equal(h.box.preferences.locationAccess,'off');
 const reply=h.chat.messages.at(-1).text;
 assert.match(reply,/^Location access is off, so I didn't use your location/);assert.match(reply,/Which city should I check\?/);
 const again=chatHarness({text:'Will it rain today?',preferences:h.box.preferences,location:{latitude:1,longitude:1}});
 await again.run();
 assert.equal(again.activity.includes('location'),false,'after a denial the app never asks again');
});

test('location unavailable keeps asking next time; non-weather and city questions never touch location',async()=>{
 const h=chatHarness({text:'Will it rain today?',preferences:KappaCore.settings({}),location:Object.assign(Error('x'),{code:'unavailable'})});
 await h.run();
 assert.equal(h.box.preferences.locationAccess,'ask');assert.match(h.chat.messages.at(-1).text,/^I couldn't get your location this time\./);
 for(const text of ['Tell me a joke','Will it rain in Paris today?']){
  const other=chatHarness({text,preferences:KappaCore.settings({}),location:{latitude:1,longitude:1}});
  await other.run();
  assert.equal(other.activity.includes('location'),false,text);assert.equal('deviceLocation' in other.sent[0],false,text);
 }
});

test('the iOS app declares why it asks and wires the one-shot native request',()=>{
 const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
 assert.match(read('ios/project.yml'),/INFOPLIST_KEY_NSLocationWhenInUseUsageDescription: .*weather/);
 const swift=read('ios/KappaForge/LocationRequester.swift');
 assert.match(swift,/requestWhenInUseAuthorization\(\)/);assert.match(swift,/requestLocation\(\)/);
 assert.doesNotMatch(swift,/startUpdatingLocation|requestAlwaysAuthorization|allowsBackgroundLocationUpdates|UserDefaults/);
 assert.match(read('ios/KappaForge/KappaWebView.swift'),/body\["action"\] == "location"/);
 assert.match(read('preview/settings.js'),/kSelect\('pin','locationAccess','Use my location'/);
});
