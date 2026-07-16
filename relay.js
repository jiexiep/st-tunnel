
const http = require('http');
const https = require('https');
const gid = process.env.GIST_ID;
const tok = process.env.GH_TOKEN;
const port = 8888;
let pending = {};
function api(m, p, d) {
  return new Promise((r,j) => {
    const o = {hostname:'api.github.com',path:p,method:m,
      headers:{'Authorization':'token '+tok,'Accept':'application/vnd.github.v3+json','User-Agent':'r'}};
    const q = https.request(o, w => { let b=''; w.on('data',c=>b+=c); w.on('end',()=>{try{r(JSON.parse(b))}catch{r(b)}}); });
    q.on('error',j); if(d) q.write(JSON.stringify(d)); q.end();
  });
}
async function gs() { const g=await api('GET','/gists/'+gid); try{return JSON.parse(g.files.q.content)}catch{return{}} }
async function ss(s) { await api('PATCH','/gists/'+gid,{files:{q:{content:JSON.stringify(s)}}}) }
async function pl() {
  while(1) {
    try {
      const s=await gs(); let c=0;
      for(const k of Object.keys(s)) if(k.startsWith('resp_')) { const i=k.slice(5); if(pending[i]) { pending[i](s[k]); delete pending[i]; delete s[k]; c=1; } }
      if(c) await ss(s);
    } catch(e) {}
    await new Promise(r=>setTimeout(r,200));
  }
}
http.createServer((q,w) => {
  let b=[]; q.on('data',c=>b.push(c));
  q.on('end',async()=>{
    const id=Date.now()+'_'+Math.random().toString(36).slice(2,6);
    const buf=Buffer.concat(b);
    const rd={method:q.method,path:q.url,headers:q.headers,body:buf.toString('base64')};
    try {
      const s=await gs(); s['req_'+id]=rd; await ss(s);
      const r=await new Promise((r,j)=>{const to=setTimeout(()=>r({code:504,headers:{},body:''}),28000); pending[id]=x=>{clearTimeout(to);r(x)};});
      w.writeHead(r.code||502,r.headers||{}); w.end(Buffer.from(r.body||'','base64'));
    } catch(e) { w.writeHead(502); w.end('err'); }
  });
}).listen(port,()=>{console.log('ok');pl()});
