// Network-first navigation. Never cache private Chat, tokens, or API responses.
self.addEventListener("install", e=>self.skipWaiting());
self.addEventListener("activate", e=>e.waitUntil(self.clients.claim()));
self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET"||new URL(request.url).origin!==self.location.origin)return;
  if(request.mode==="navigate")event.respondWith(fetch(request,{cache:"no-store"}));
});
