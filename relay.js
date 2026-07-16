
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const fs = require('fs');
const gid = process.env.GIST_ID;
const tok = process.env.GH_TOKEN;
const port = 8888;
let pending = {};

function api(m, p, d) {
  return new Promise((r,j) => {
    const o = {hostname:'api.github.com',path:p,method:m,
      headers:{'Authorization':'token '+tok,'Accept':'application/vnd.github.v3+json','User-Agent':'r','Content-Type':'application/json'}};
    const q = https.request(o, w => { let b=''; w.on('data',c=>b+=c); w.on('end',()=>{try{r(JSON.parse(b))}catch{r(b)}}); });
    q.on('error',j); if(d) q.write(JSON.stringify(d)); q.end();
  });
}

async function tick() {
  try {
    const g = await api('GET','/gists/'+gid);
    const s = JSON.parse(g.files.q.content);
    let dirty = false;
    for (const k of Object.keys(s)) {
      if (k.startsWith('resp_')) {
        const id = k.slice(5);
        if (pending[id]) { pending[id](s[k]); delete pending[id]; delete s[k]; dirty = true; }
      }
    }
    if (dirty) await api('PATCH','/gists/'+gid,{files:{q:{content:JSON.stringify(s)}}});
  } catch(e) {}
}

setInterval(tick, 500);

http.createServer((q,w) => {
  let b=[]; q.on('data',c=>b.push(c));
  q.on('end',async()=>{
    const id=Date.now()+'_'+Math.random().toString(36).slice(2,8);
    const buf=Buffer.concat(b);
    const rd={method:q.method,path:q.url,headers:q.headers,body:buf.toString('base64')};
    console.log('REQ', q.method, q.url);
    try {
      const g = await api('GET','/gists/'+gid);
      const s = JSON.parse(g.files.q.content);
      s['req_'+id] = rd;
      await api('PATCH','/gists/'+gid,{files:{q:{content:JSON.stringify(s)}}});
      const r = await new Promise((res) => {
        const to = setTimeout(() => res({code:504,headers:{},body:''}), 30000);
        pending[id] = (x) => { clearTimeout(to); res(x); };
      });
      w.writeHead(r.code||502,r.headers||{});
      if (r.body) w.end(Buffer.from(r.body,'base64'));
      else w.end();
      console.log('RES', r.code||502);
    } catch(e) {
      console.log('ERR', e.message);
      w.writeHead(502); w.end(e.message);
    }
  });
}).listen(port, '0.0.0.0', () => {
  console.log('relay on 0.0.0.0:'+port);
  
  const cfPath = '/tmp/cloudflared';
  if (fs.existsSync(cfPath)) {
    setTimeout(() => {
      const cf = spawn(cfPath, ['tunnel', '--url', 'http://localhost:'+port], {stdio:['ignore','pipe','pipe']});
      cf.stdout.on('data', d => {
        const s = d.toString();
        process.stdout.write(s);
        const m = s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (m) {
          const url = m[0];
          console.log('CF URL:', url);
          api('GET','/gists/'+gid).then(async g => {
            try {
              const state = JSON.parse(g.files.q.content);
              state.url = url;
              await api('PATCH','/gists/'+gid,{files:{q:{content:JSON.stringify(state)}}});
              console.log('CF URL written');
            } catch(e) {}
          });
        }
      });
      cf.stderr.on('data', d => process.stderr.write(d));
      cf.on('exit', c => console.log('cf exit:', c));
    }, 500);
  }
});
