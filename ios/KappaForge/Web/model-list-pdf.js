/* The owner's downloadable model list as a PDF: every model KappaForge uses by provider, the specialist tools it keeps,
   and the models removed after the model audit with the reason for each. Plain ASCII PDF (built-in Helvetica, no
   compression), so it travels through the text-only native export like the other exports. No DOM, network or storage. */
(function(root){
'use strict';
const W=612,H=792,M=50,LINE=13;
const ASCII={'‘':"'",'’':"'",'“':'"','”':'"','–':'-','—':'-','…':'...','·':'-','→':'->',' ':' '};
// PDF text: ASCII only, with the string delimiters escaped.
const clean=text=>String(text??'').replace(/[^\x20-\x7e]/g,c=>ASCII[c]??'?').replace(/[\\()]/g,c=>'\\'+c);
// Approximate Helvetica width: enough to wrap long reasons inside their column.
const width=(text,size)=>String(text).length*size*0.5;
function wrap(text,size,max){
 const words=String(text??'').split(/\s+/).filter(Boolean),lines=[];let line='';
 for(const word of words){const next=line?line+' '+word:word;if(width(next,size)>max&&line){lines.push(line);line=word;}else line=next;}
 if(line)lines.push(line);
 return lines.length?lines:[''];
}
const COLORS={ink:'0.07 0.09 0.15',grey:'0.42 0.45 0.5',green:'0.12 0.54 0.3',amber:'0.7 0.42 0',red:'0.75 0.22 0.17',blue:'0.15 0.39 0.92'};
const PROBE={answered:['Answered','green'],rate_limited:['Maxed out right now','amber'],provider_error:['Provider busy','amber'],timeout:['No reply in time','amber'],
 cooling_down:['Resting','amber'],empty_response:['Replied empty','blue'],not_found:['Not found','red'],needs_credits:['Needs payment','red'],denied:['Access denied','red'],rejected:['Rejected','red']};

function build(data,probeResults=[],now=Date.now()){
 const probe=new Map((probeResults||[]).map(r=>[r.label,r]));
 const pages=[];let ops=[],y=H-M;
 const page=()=>{if(ops.length)pages.push(ops);ops=[];y=H-M;};
 const need=h=>{if(y-h<M+20)page();};
 const text=(x,s,size=10,{bold=false,color='ink'}={})=>{ops.push('BT /'+(bold?'F2':'F1')+' '+size+' Tf '+COLORS[color]+' rg '+x+' '+y+' Td ('+clean(s)+') Tj ET');};
 const gap=n=>{y-=n;};
 const heading=(s,size)=>{need(size+16);gap(size/2);text(M,s,size,{bold:true});gap(size+6);};
 const providers=data?.providers||[];
 const count=k=>providers.reduce((n,p)=>n+(p[k]?.length||0),0);

 text(M,'KappaForge Model List',22,{bold:true});gap(20);
 text(M,'Downloaded '+new Date(now).toISOString().slice(0,16).replace('T',' ')+' UTC'+(probe.size?' - statuses from your last model test in the app':''),9,{color:'grey'});gap(24);
 text(M,count('models')+' models in use',13,{bold:true,color:'green'});text(M+170,count('tools')+' specialist tools kept',13,{bold:true,color:'blue'});
 text(M+360,count('removed')+' removed',13,{bold:true,color:'red'});gap(24);
 const cols=[M,M+220,M+300,M+380,M+460];
 ['Provider','In use','Tools','Removed'].forEach((h,i)=>text(cols[i],h,9.5,{bold:true}));gap(LINE+2);
 for(const p of providers){need(LINE);text(cols[0],p.name,9.5);text(cols[1],String(p.models.length),9.5,{color:'green'});
  text(cols[2],String(p.tools.length),9.5,{color:'blue'});text(cols[3],String(p.removed.length),9.5,{color:'red'});gap(LINE);}
 gap(10);

 heading('Part 1: Models in use',15);
 for(const p of providers.filter(p=>p.models.length)){
  need(LINE*3);text(M,p.name+' ('+p.models.length+')',11,{bold:true});gap(LINE+2);
  for(const model of [...p.models].sort()){
   need(LINE);text(M+8,model,8.5);
   const r=probe.get(p.id==='gemini'?model:p.id+':'+model),[label,color]=r?PROBE[r.outcome]||[r.outcome,'grey']:['In use','green'];
   text(M+330,label+(r?.outcome==='answered'&&Number.isFinite(r.latencyMs)?' - '+(r.latencyMs/1000).toFixed(1)+'s':''),8.5,{color});gap(LINE-1);
  }
  gap(4);
 }
 if(count('tools')){
  heading('Part 2: Specialist tools (kept, not used for chat)',15);
  for(const p of providers.filter(p=>p.tools.length)){
   need(LINE*3);text(M,p.name+' ('+p.tools.length+')',11,{bold:true});gap(LINE+2);
   for(const t of p.tools){const lines=wrap(t.note,8.5,W-M-330);need(LINE*lines.length);text(M+8,t.model,8.5);text(M+230,t.kind,8.5,{bold:true,color:'blue'});
    lines.forEach((l,i)=>{text(M+330,l,8.5,{color:'grey'});gap(LINE-1);});}
   gap(4);
  }
 }
 heading('Part 3: Removed models and why',15);
 for(const p of providers.filter(p=>p.removed.length)){
  need(LINE*3);text(M,p.name+' ('+p.removed.length+')',11,{bold:true});gap(LINE+2);
  for(const r of [...p.removed].sort((a,b)=>a.reason.localeCompare(b.reason)||a.model.localeCompare(b.model))){
   const lines=wrap(r.reason,8,W-M-290);need((LINE-2)*lines.length+2);text(M+8,r.model,8.5);
   lines.forEach(l=>{text(M+290,l,8,{color:'red'});gap(LINE-2);});gap(2);
  }
  gap(4);
 }
 page();
 // Objects: catalog, page tree, two fonts, then a page and its content stream per page.
 const objects=['<< /Type /Catalog /Pages 2 0 R >>',null,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
 const kids=[];
 pages.forEach((content,i)=>{
  const footer='BT /F1 8 Tf '+COLORS.grey+' rg '+M+' 30 Td (KappaForge model list - page '+(i+1)+' of '+pages.length+') Tj ET';
  const stream=[...content,footer].join('\n');
  objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+W+' '+H+'] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents '+(objects.length+2)+' 0 R >>');
  kids.push(objects.length+' 0 R');
  objects.push('<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream');
 });
 objects[1]='<< /Type /Pages /Kids ['+kids.join(' ')+'] /Count '+pages.length+' >>';
 let pdf='%PDF-1.4\n';const offsets=[];
 objects.forEach((o,i)=>{offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\n'+o+'\nendobj\n';});
 const xref=pdf.length;
 pdf+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'+offsets.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('');
 pdf+='trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';
 return pdf;
}
root.KappaModelPDF={build,clean,wrap};
})(globalThis);
