// Live-admission reads for tests whose subject is not free-execution policy: the public KappaForge repository and
// its enabled reviewed workflows. tests/free-execution.test.mjs covers the refusals.
const PUBLIC={full_name:'onlykappa/KappaForge',private:false,visibility:'public',archived:false,disabled:false};
export function freeMetadata(url){
 const path=new URL(String(url)).pathname;
 if(path==='/repos/onlykappa/KappaForge')return Response.json(PUBLIC);
 const m=path.match(/^\/repos\/onlykappa\/KappaForge\/actions\/workflows\/([\w.-]+\.yml)$/);
 return m?Response.json({state:'active',path:'.github/workflows/'+m[1]}):null;
}
export const withFreeExecution=fn=>async(url,init)=>freeMetadata(url)||fn(url,init);
