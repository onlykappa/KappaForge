import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../chat-backend/src/index.js';
import '../preview/core.js';
import {weatherTools,weatherRequest,weatherArguments,invokeWeatherTool,formatWeather} from '../chat-backend/src/weather.js';
const fixture=()=>({timezone:'America/Los_Angeles',current:{time:'2026-10-22T09:00',temperature_2m:51,weather_code:3,wind_speed_10m:5,wind_direction_10m:180},hourly:{time:Array.from({length:48},(_,i)=>`2026-10-${22+Math.floor(i/24)}T${String(i%24).padStart(2,'0')}:00`),temperature_2m:Array(48).fill(52),precipitation_probability:Array(48).fill(25),wind_speed_10m:Array(48).fill(6)},daily:{time:Array.from({length:7},(_,i)=>`2026-10-${22+i}`),temperature_2m_min:Array(7).fill(42),temperature_2m_max:Array(7).fill(60),precipitation_probability_max:Array(7).fill(30),wind_speed_10m_max:Array(7).fill(12)}});
function upstream(data=fixture()) {const calls=[];return {calls,fetcher:async(url,init)=>{calls.push({url:new URL(url),init});return Response.json(String(url).includes('geocoding-api')?{results:[{name:'Spokane Valley',admin1:'Washington',country:'United States',latitude:47.67,longitude:-117.24}]}:data)}};}
const request=(path,body,token='weather-test',method='POST')=>new Request('https://worker.test'+path,{method,headers:{Origin:'null',Authorization:'Bearer '+token,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})});
const env={CHAT_ACCESS_TOKEN:'weather-test',GEMINI_API_KEY:'fixture'};
test('weather is discoverable and preferences retain only validated city and units',()=>{
 assert.equal(weatherTools[0].name,'weather');
 assert.deepEqual(weatherArguments('What is the weather in Spokane Valley today?',{weatherCity:'Paris',weatherUnits:'fahrenheit'}),{city:'Spokane Valley',units:'fahrenheit'});
 assert.equal(weatherArguments('Will it rain tomorrow?',{weatherCity:'Paris',locale:'en-US'}).units,'fahrenheit');
 assert.equal(weatherArguments('Weather in Paris in Celsius?',{weatherUnits:'fahrenheit'}).units,'celsius');
 const settings=KappaCore.settings({weatherCity:' Paris ',weatherUnits:'fahrenheit'});assert.equal(settings.weatherCity,'Paris');assert.equal(settings.weatherUnits,'fahrenheit');
 assert.equal(KappaCore.settings({weatherUnits:'kelvin'}).weatherUnits,'auto');
 for(const text of ['What’s the weather in Spokane Valley?','Will it rain tomorrow?','What is the seven-day forecast?'])assert.ok(weatherRequest(text.replace('’',"'")));
 assert.equal(weatherRequest('Implement a weather endpoint'),false);
});
test('real tool geocodes and returns current, hourly and seven-day data with units and local time',async()=>{
 const mock=upstream();const data=await invokeWeatherTool('weather',{city:'Spokane Valley',units:'fahrenheit'},{...mock,store:new Map()});
 assert.match(data.location,/Spokane Valley/);assert.equal(data.daily.length,7);assert.equal(data.hourly.length,48);
 assert.equal(mock.calls[1].url.searchParams.get('latitude'),'47.67');assert.equal(mock.calls[1].url.searchParams.get('temperature_unit'),'fahrenheit');assert.equal(mock.calls[1].url.searchParams.get('timezone'),'auto');
 const answer=formatWeather(data,'seven-day forecast hourly');assert.match(answer,/51°F/);assert.match(answer,/America\/Los_Angeles/);assert.match(answer,/2026-10-28/);assert.match(answer,/Hourly/);assert.match(answer,/25%/);
 assert.match(formatWeather(data,'Will it rain tomorrow?'),/2026-10-23/);
});
test('missing location, invalid coordinates and unknown tools fail before fetching or GPS access',async()=>{
 const fetcher=()=>{throw Error('must not fetch')};
 for(const input of [{},{latitude:NaN,longitude:1},{latitude:91,longitude:1},{latitude:1},{city:'x',units:'kelvin'}])await assert.rejects(invokeWeatherTool('weather',input,{fetcher}),/city|latitude|Celsius/i);
 await assert.rejects(invokeWeatherTool('unknown',{city:'Paris'},{fetcher}),/Unknown/);
});
test('cache expires, separates units, is bounded and rejects cancelled callers',async()=>{
 const mock=upstream(),store=new Map();let clock=1000;
 const opts={...mock,store,now:()=>clock};
 const input={latitude:47.67,longitude:-117.24};await invokeWeatherTool('weather',input,opts);
 assert.equal((await invokeWeatherTool('weather',input,opts)).cached,true);assert.equal(mock.calls.length,1);
 await invokeWeatherTool('weather',{...input,units:'fahrenheit'},opts);assert.equal(mock.calls.length,2);
 clock+=300001;await invokeWeatherTool('weather',input,opts);assert.equal(mock.calls.length,3);
 for(let i=0;i<70;i++)await invokeWeatherTool('weather',{latitude:i,longitude:1},opts);assert.equal(store.size,64);
 const abort=new AbortController();abort.abort();await assert.rejects(invokeWeatherTool('weather',input,{...opts,signal:abort.signal}),/cancelled/);
});
test('invalid city, upstream errors, timeouts and malformed/incomplete forecasts never claim success',async()=>{
 await assert.rejects(invokeWeatherTool('weather',{city:'missing'},{store:new Map(),fetcher:async()=>Response.json({results:[]})}),/find that city/);
 for(const fetcher of [async()=>{throw new DOMException('timeout','TimeoutError')},async()=>new Response('bad',{status:503}),async()=>Response.json({}),async()=>Response.json({...fixture(),current:{temperature_2m:null}})])await assert.rejects(invokeWeatherTool('weather',{latitude:1,longitude:1},{store:new Map(),fetcher}),/Weather service/);
});
test('authenticated normal chat invokes the weather tool and returns data-driven text; failures stay honest',async()=>{
 const original=globalThis.fetch,mock=upstream();globalThis.fetch=mock.fetcher;
 try{
  const response=await worker.fetch(request('/chat',{messages:[{role:'user',text:'What is the weather in Spokane Valley today?'}],preferences:{weatherUnits:'fahrenheit'}}),env,{});
  const data=await response.json();assert.equal(response.status,200);assert.match(data.reply,/Spokane Valley/);assert.match(data.reply,/51°F/);assert.equal(data.tool.source,'Open-Meteo');assert.equal(mock.calls.length,2);
  const noCity=await worker.fetch(request('/chat',{messages:[{role:'user',text:'Will it rain tomorrow?'}]}),env,{});assert.match((await noCity.json()).reply,/Which city/);assert.equal(mock.calls.length,2);
  const saved=await worker.fetch(request('/chat',{messages:[{role:'user',text:'Will it rain tomorrow?'}],preferences:{weatherCity:'Spokane Valley',weatherUnits:'fahrenheit'}}),env,{});assert.match((await saved.json()).reply,/2026-10-23/);
 }finally{globalThis.fetch=original;}
});
test('chat weather enforces auth and methods before external calls; capabilities exposes tool discovery',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('unexpected')};
 try{
  assert.equal((await worker.fetch(request('/chat',{messages:[{role:'user',text:'Weather in Spokane Valley?'}]},'wrong'),env,{})).status,401);
  assert.equal((await worker.fetch(request('/chat',{},'weather-test','GET'),env,{})).status,404);
  assert.equal(calls,0,'rejected authentication and methods never reach any upstream');
  const discover=await worker.fetch(request('/capabilities',{}),{CHAT_ACCESS_TOKEN:'weather-test',ROUTING_POLICY_VERSION:'v1'},{});assert.equal((await discover.json()).tools[0].name,'weather');
  const failed=await worker.fetch(request('/chat',{messages:[{role:'user',text:'Weather in Test Failure City?'}]}),env,{});const data=await failed.json();assert.equal(data.tool.status,'unavailable');assert.match(data.reply,/timed out/);
 }finally{globalThis.fetch=original;}
});


test('city followup after a location question works without an LLM key or geolocation permission',async()=>{
 const original=globalThis.fetch,mock=upstream();globalThis.fetch=mock.fetcher;
 try{
  const result=await worker.fetch(request('/chat',{messages:[{role:'assistant',text:'Which city should I check? You can save a default city.'},{role:'user',text:'Paris'}],preferences:{weatherUnits:'celsius'}}),{CHAT_ACCESS_TOKEN:'weather-test'},{});
  const data=await result.json();assert.equal(result.status,200);assert.equal(data.tool.source,'Open-Meteo');assert.match(data.reply,/51°C/);
  assert.deepEqual(weatherArguments('What is the forecast for tomorrow?',{weatherCity:'Paris'}),{city:'Paris',units:'celsius'});
 }finally{globalThis.fetch=original;}
});
