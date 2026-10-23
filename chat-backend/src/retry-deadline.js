// Any eligible route recovering is enough to retry; a later failure must not erase it.
export function retryDeadline(current,next,now=Date.now()){
 const future=[current,next].filter(value=>Number.isFinite(value)&&value>now);
 return future.length?Math.min(...future):null;
}
