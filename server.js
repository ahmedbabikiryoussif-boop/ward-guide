const express=require('express'),rateLimit=require('express-rate-limit'),Anthropic=require('@anthropic-ai/sdk');
const {MODES,RULES}=require('./prompts');
const app=express(),client=new Anthropic();
const CODES=(process.env.ACCESS_CODES||'').split(',').map(s=>s.trim()).filter(Boolean);
const E='https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
app.set('trust proxy',1);
app.use(express.json({limit:'20kb'}));
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
    const st=client.messages.stream({model:'claude-sonnet-5-5',max_tokens:3500,tools:[{type:'web_search_20250305',name:'web_search',max_uses:4}],messages:[{role:'user',content:prompt}]});
    st.on('text',t=>res.write(t)); await st.finalMessage();
  }catch(e){console.error('claude',e.message);res.write('\n\n[Error: the request could not be completed]')}
  res.end();
});
app.listen(process.env.PORT||3000,()=>console.log('Ward Guide running'));
