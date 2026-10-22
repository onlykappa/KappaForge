// Explicit read-only live check. No deployed Worker, model inference or credentials.
import assert from 'node:assert/strict';
import worker from '../chat-backend/src/index.js';
const request=new Request('https://local-weather-check/chat',{method:'POST',headers:{Origin:'null',Authorization:'Bearer local-weather-check','Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',text:'What is the weather in Spokane Valley today?'}],preferences:{weatherUnits:'fahrenheit'}})});
const response=await worker.fetch(request,{CHAT_ACCESS_TOKEN:'local-weather-check'},{});
const result=await response.json();assert.equal(response.status,200);assert.equal(result.tool?.source,'Open-Meteo',result.reply);assert.match(result.reply,/Spokane Valley/);assert.equal(result.tool.daily.length,7);assert.ok(result.tool.hourly.length>=24);
console.log(JSON.stringify({verified:true,path:'authenticated /chat -> weather tool -> real geocoding and forecast APIs',location:result.tool.location,timezone:result.tool.timezone,observedAt:result.tool.current.time,fetchedAt:new Date(result.tool.fetchedAt).toISOString(),hourly:result.tool.hourly.length,days:result.tool.daily.length,reply:result.reply},null,2));
