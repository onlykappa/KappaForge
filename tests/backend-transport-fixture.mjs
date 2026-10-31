// Component harnesses load slices of classic scripts. Supply their new dependency
// with the actual production transport and each harness's existing network fake.
import '../preview/auth-transport.js';
export function installTransport(box){
 const client=globalThis.KappaTransport.create({connection:()=>({backend:box.backend,access:box.access,mode:'legacy'}),
  fetch:(url,options)=>box.fetch(url,options)});
 box.backendFetch=(path,options)=>client.fetch(path,options);
 return box;
}
