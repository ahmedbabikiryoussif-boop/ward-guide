const PDFDocument=require('pdfkit'),express=require('express'),rateLimit=require('express-rate-limit'),Anthropic=require('@anthropic-ai/sdk');
const {MODES,RULES}=require('./prompts');
const app=express(),client=new Anthropic();
const CODES=(process.env.ACCESS_CODES||'').split(',').map(s=>s.trim()).filter(Boolean);
const E='https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
app.set('trust proxy',1);
app.use(express.json({limit:'80kb'}));
const WEB=['index.html','sw.js','manifest.webmanifest','icon-180.png','icon-192.png','icon-512.png'];
app.get('/',(q,r)=>r.sendFile('index.html',{root:__dirname}));
app.get('/:f',(q,r,n)=>WEB.includes(q.params.f)?r.sendFile(q.params.f,{root:__dirname}):n());
app.use('/api',rateLimit({windowMs:60000,max:10}));
const tag=(x,t)=>{const m=x.match(new RegExp('<'+t+'[^>]*>([\\s\\S]*?)</'+t+'>'));return m?m[1].replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim():''};
async function pubmed(text,mode){
  const r=await client.messages.create({model:'claude-haiku-5-5',max_tokens:150,messages:[{role:'user',content:'Write ONE PubMed search query (MeSH terms and keywords, no filters, no explanation) for the main clinical topic of this text:\n'+text}]});
  const term=r.content[0].text.trim().replace(/^["`]+|["`]+$/g,'');
  const f=' AND hasabstract AND (guideline[pt] OR systematic review[pt] OR meta-analysis[pt] OR randomized controlled trial[pt]) AND humans[mh] AND english[la]';
  const s=await (await fetch(E+'esearch.fcgi?db=pubmed&retmode=json&retmax=8&sort='+(mode==='evidence'?'date':'relevance')+'&term='+encodeURIComponent('('+term+')'+f))).json();
  const ids=s.esearchresult.idlist; if(!ids.length)return [];
  const xml=await (await fetch(E+'efetch.fcgi?db=pubmed&retmode=xml&id='+ids.join(','))).text();
  return xml.split('<PubmedArticle>').slice(1).map(a=>({pmid:tag(a,'PMID'),title:tag(a,'ArticleTitle'),journal:tag(a,'Title'),year:(a.match(/<PubDate>[\s\S]*?<Year>(\d{4})/)||[])[1]||'',abs:tag(a,'Abstract').slice(0,1500)}));
}
app.post('/api/ask',async(req,res)=>{
  const {text,mode}=req.body||{};
  if(!CODES.includes(req.get('x-access-code')))return res.status(401).end();
  if(typeof text!=='string'||!text.trim()||text.length>2000||!MODES[mode])return res.status(400).end();
  res.set({'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-cache'});
  let papers=[];try{papers=await pubmed(text,mode)}catch(e){console.error('pubmed',e.message)}
  const ctx=papers.length?papers.map(p=>`[PMID ${p.pmid}] ${p.title} (${p.journal}, ${p.year})\n${p.abs}`).join('\n\n'):'No PubMed records retrieved.';
  const prompt=RULES+'\n\n'+MODES[mode]+'\n\nLive PubMed records retrieved for this question (cite by PMID; list those you used under References as "Authors or title, Journal, Year, PMID"). You may also use web search for current guidelines and give their URL. Do not cite anything you were not given or did not find.\n\n'+ctx+'\n\nQuestion or case:\n'+text;
  try{
    const st=client.messages.stream({model:'claude-sonnet-5-5',max_tokens:({full:7000,mrcp:7000,evidence:5000,oncall:3000,quick:2000})[mode],tools:[{type:'web_search_20250305',name:'web_search',max_uses:(mode==='oncall'||mode==='quick')?2:3}],messages:[{role:'user',content:prompt}]});
    st.on('text',t=>res.write(t)); const fm=await st.finalMessage(); if(fm.stop_reason==='max_tokens')res.write('\n\n[The answer was cut off. Tap Search again, or use Quick answer.]');
  }catch(e){console.error('claude',e.message);res.write('\n\n[Error: the request could not be completed]')}
  res.end();
});

const clean=s=>String(s).replace(/≥/g,'>=').replace(/≤/g,'<=').replace(/[→⇒]/g,'->').replace(/←/g,'<-').replace(/≈/g,'~').replace(/[µμ]g/g,'microgram').replace(/[µμ]/g,'u').replace(/[₀-₉]/g,c=>String(c.charCodeAt(0)-0x2080)).replace(/[−‑‐]/g,'-').replace(/\*\*|__|`/g,'').replace(/\*(?=\S)([^*\n]+)\*/g,'$1').replace(/[^\x09\x0A\x20-\x7E\u00A0-\u00FF\u2018\u2019\u201C\u201D\u2013\u2014\u2022\u2026]/g,'');
app.post('/api/pdf',(req,res)=>{
  const {title,text}=req.body||{};
  if(!CODES.includes(req.get('x-access-code')))return res.status(401).end();
  if(typeof text!=='string'||!text.trim()||text.length>40000)return res.status(400).end();
  const doc=new PDFDocument({size:'A4',margins:{top:50,bottom:55,left:50,right:50},bufferPages:true,info:{Title:'Ward Guide'}});
  res.set({'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="ward-guide.pdf"'});
  doc.pipe(res);
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#0b6e8a').text('Ward Guide');
  doc.font('Helvetica').fontSize(9).fillColor('#555').text(new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}));
  doc.moveDown(.4).font('Helvetica-Bold').fontSize(11).fillColor('#000').text(clean(title||'').slice(0,300));
  doc.moveDown(.6);
  let items=[],type=null;
  const flush=()=>{if(items.length){doc.font('Helvetica').fontSize(10).fillColor('#111').list(items,{bulletRadius:1.6,textIndent:12,bulletIndent:4,listType:type==='ol'?'numbered':'bullet'});doc.moveDown(.3)}items=[];type=null};
  for(const raw of clean(text).split('\n')){
    const l=raw.trimEnd();let m;
    if(m=l.match(/^#{1,2}\s+(.*)/)){flush();doc.moveDown(.5).font('Helvetica-Bold').fontSize(12.5).fillColor('#0b6e8a').text(m[1]);doc.moveDown(.2)}
    else if(m=l.match(/^#{3,}\s+(.*)/)){flush();doc.moveDown(.3).font('Helvetica-Bold').fontSize(10.5).fillColor('#000').text(m[1])}
    else if(m=l.match(/^\s*[-*•]\s+(.*)/)){if(type&&type!=='ul')flush();type='ul';items.push(m[1])}
    else if(m=l.match(/^\s*\d+[.)]\s+(.*)/)){if(type&&type!=='ol')flush();type='ol';items.push(m[1])}
    else if(!l.trim()){flush()}
    else{flush();doc.font('Helvetica').fontSize(10).fillColor('#111').text(l);doc.moveDown(.2)}
  }
  flush();
  const r=doc.bufferedPageRange();
  for(let i=0;i<r.count;i++){doc.switchToPage(i);const b=doc.page.margins.bottom;doc.page.margins.bottom=0;
    doc.font('Helvetica').fontSize(8).fillColor('#777').text('Ward Guide - decision support only. Check doses in the BNF and verify references. Page '+(i+1)+' of '+r.count,50,doc.page.height-32,{width:doc.page.width-100,align:'center'});doc.page.margins.bottom=b}
  doc.end();
});
app.listen(process.env.PORT||3000,()=>console.log('Ward Guide running'));
