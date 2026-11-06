const encode64=bytes=>{let raw="";for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(raw);};
const decode64=data=>Uint8Array.from(atob(data),c=>c.charCodeAt(0));
async function deriveVaultKey(pass,salt){
 const base=await crypto.subtle.importKey("raw",new TextEncoder().encode(pass),"PBKDF2",false,["deriveKey"]);
 return crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:160000,hash:"SHA-256"},base,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
async function encryptVault(data,pass){
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
 const key=await deriveVaultKey(pass,salt);
 const raw=new TextEncoder().encode(JSON.stringify(data));
 if(raw.length>280000)throw Error("Backup exceeds 280 KB. Trim older conversations before syncing.");
 const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},key,raw));
 return JSON.stringify({v:1,salt:encode64(salt),iv:encode64(iv),data:encode64(ciphertext)});
}
async function decryptVault(payload,pass){
 const o=JSON.parse(payload);
 if(o.v!==1)throw Error("Unsupported cloud backup version");
 const key=await deriveVaultKey(pass,decode64(o.salt));
 const raw=await crypto.subtle.decrypt({name:"AES-GCM",iv:decode64(o.iv)},key,decode64(o.data));
 const result=JSON.parse(new TextDecoder().decode(raw));
 if(!result||!Array.isArray(result.chats)||!Array.isArray(result.notes)||result.notes.some(n=>typeof n!=="string"||n.length>400)||result.chats.some(c=>!c||typeof c.id!=="string"||!Array.isArray(c.messages)||c.messages.some(m=>!m||!["assistant","user"].includes(m.role)||typeof m.text!=="string")))throw Error("Backup format invalid");
 return result;
}