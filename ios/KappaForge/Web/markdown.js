/* Deliberately small Markdown renderer. Raw HTML and unsafe link schemes never execute. */
(function(root){
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function inline(text,depth=0){
  text=String(text);if(depth>3)return escape(text);
  const pattern=/`([^`\n]+)`|\[([^\]\n]+)\]\(([^\s)]+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|~~([^~\n]+)~~/g;
  let html='',at=0,match;
  while((match=pattern.exec(text))){html+=escape(text.slice(at,match.index));
   if(match[1])html+='<code>'+escape(match[1])+'</code>';
   else if(match[2]){let safe=false;try{safe=['https:','http:'].includes(new URL(match[3]).protocol)}catch{}html+=safe?'<a href="'+escape(match[3])+'" target="_blank" rel="noopener noreferrer">'+inline(match[2],depth+1)+'</a>':escape(match[2]);}
   else if(match[4]||match[5])html+='<strong>'+inline(match[4]||match[5],depth+1)+'</strong>';
   else if(match[6])html+='<em>'+inline(match[6],depth+1)+'</em>';
   else if(match[7])html+='<del>'+inline(match[7],depth+1)+'</del>';
   at=pattern.lastIndex;
  }
  return html+escape(text.slice(at));
 }
 function cells(line){return line.trim().replace(/^\|/,'').replace(/\|$/,'').split(/(?<!\\)\|/).slice(0,20).map(c=>c.trim().replace(/\\\|/g,'|'));}
 function render(text){
  const lines=String(text??'').replace(/\r\n?/g,'\n').split('\n');let html='',i=0;
  const block=l=>/^(?:```|#{1,4}\s|>\s?|\s*[-*+]\s|\s*\d+\.\s|\s*---\s*$)/.test(l);
  while(i<lines.length){let line=lines[i];if(!line.trim()){i++;continue;}
   if(/^```/.test(line)){const lang=line.slice(3).trim().replace(/[^\w+#.-]/g,'').slice(0,30);const body=[];i++;while(i<lines.length&&!/^```\s*$/.test(lines[i]))body.push(lines[i++]);if(i<lines.length)i++;
    html+='<div class="code-block"><div class="code-bar"><span>'+escape(lang||'Code')+'</span><button type="button" class="code-copy" data-copy-code aria-label="Copy code">Copy code</button></div><pre tabindex="0"><code>'+escape(body.join('\n'))+'</code></pre></div>';continue;}
   const heading=line.match(/^(#{1,4})\s+(.+)$/);if(heading){const level=heading[1].length+1;html+='<h'+level+'>'+inline(heading[2])+'</h'+level+'>';i++;continue;}
   if(/^\s*(?:---|\*\*\*)\s*$/.test(line)){html+='<hr>';i++;continue;}
   if(i+1<lines.length&&line.includes('|')&&/^\s*\|?\s*:?-{3,}/.test(lines[i+1])&&cells(lines[i+1]).every(c=>/^:?-{3,}:?$/.test(c))){
    const heads=cells(line);i+=2;const rows=[];while(i<lines.length&&lines[i].includes('|')&&rows.length<100)rows.push(cells(lines[i++]));
    html+='<div class="markdown-table" tabindex="0" aria-label="Response table"><table><thead><tr>'+heads.map(c=>'<th>'+inline(c)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+heads.map((_,j)=>'<td>'+inline(row[j]||'')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';continue;}
   if(/^>/.test(line)){const quote=[];while(i<lines.length&&/^>/.test(lines[i]))quote.push(lines[i++].replace(/^>\s?/,''));html+='<blockquote>'+quote.map(l=>inline(l)).join('<br>')+'</blockquote>';continue;}
   if(/^\s*(?:[-*+]|\d+\.)\s/.test(line)){const ordered=/^\s*\d+\./.test(line),tag=ordered?'ol':'ul',items=[];while(i<lines.length&&(ordered?/^\s*\d+\.\s/:/^\s*[-*+]\s/).test(lines[i]))items.push(lines[i++].replace(/^\s*(?:[-*+]|\d+\.)\s+/,''));html+='<'+tag+'>'+items.map(l=>'<li>'+inline(l)+'</li>').join('')+'</'+tag+'>';continue;}
   const paragraph=[line];i++;while(i<lines.length&&lines[i].trim()&&!block(lines[i])&&!(i+1<lines.length&&lines[i].includes('|')&&/^\s*\|?\s*:?-{3,}/.test(lines[i+1])))paragraph.push(lines[i++]);html+='<p>'+paragraph.map(l=>inline(l)).join('<br>')+'</p>';
  }
  return html;
 }
 root.KappaMarkdown={render,inline,escape};
})(globalThis);
