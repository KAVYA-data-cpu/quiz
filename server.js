const express=require('express'),bcrypt=require('bcryptjs'),fs=require('fs'),path=require('path'),crypto=require('crypto');
// ---- database: Turso (hosted libSQL) in production, a local file for development
let DB_URL=process.env.TURSO_DATABASE_URL||process.env.DB_URL||'file:wizard.db';const local=DB_URL.startsWith('file:');
if(!local)DB_URL=DB_URL.replace(/^libsql:\/\//,'https://');
let createClient;if(local){createClient=require('@libsql/client').createClient}else{createClient=require('@libsql/client/web').createClient}
if(process.env.VERCEL&&local)throw new Error('TURSO_DATABASE_URL is not set');
const db=createClient({url:DB_URL,authToken:process.env.TURSO_AUTH_TOKEN});
const rows=async(sql,a=[])=>{const r=await db.execute({sql,args:a});return r.rows.map(x=>Object.fromEntries(r.columns.map((c,i)=>[c,x[i]])))};
const one=async(sql,a)=>(await rows(sql,a))[0];const run=(sql,a=[])=>db.execute({sql,args:a});
const SCHEMA=`
create table if not exists participants(id integer primary key,team_number text unique not null,password_hash text not null,created_at integer,last_login integer,login_status text default 'offline');
create table if not exists administrators(id integer primary key,username text unique not null,password_hash text not null);
create table if not exists settings(key text primary key,value text);
create table if not exists round_progress(id integer primary key,participant_id integer not null references participants(id),round_number integer not null,status text default 'not_started',started_at integer,completed_at integer,elapsed_seconds integer,unique(participant_id,round_number));
create table if not exists quiz_questions(id integer primary key,question text,option_a text,option_b text,option_c text,option_d text,correct_option text,difficulty text,category text);
create table if not exists quiz_responses(id integer primary key,participant_id integer not null references participants(id),question_id integer not null references quiz_questions(id),selected_option text,updated_at integer,unique(participant_id,question_id));
create table if not exists quiz_submissions(id integer primary key,participant_id integer unique not null references participants(id),submitted_at integer,started_at integer,elapsed_seconds integer,score integer,status text);
create table if not exists login_fails(k text,t integer);
create index if not exists ix_lf on login_fails(k,t);create index if not exists ix_rp on round_progress(participant_id);create index if not exists ix_qr on quiz_responses(participant_id);`;
const QS=[["HTML","Easy","Which HTML tag creates a hyperlink?","<link>","<a>","<href>","<nav>","B"],["HTML","Easy","Which attribute provides alternative text for an image?","title","src","alt","name","C"],["HTML","Easy","Which HTML tag creates an unordered (bulleted) list?","<ol>","<li>","<ul>","<list>","C"],["HTML","Moderate","What does the required attribute do on an input element?","Makes the input read-only","Hides the input from the page","Requires a value before form submission can succeed","Automatically fills the input","C"],["HTML","Tough",'Consider: <label for="email">Email</label> <input id="email" type="email">. What happens when a user activates the label?',"The browser submits the form","The associated input receives focus","The input becomes required","The input is automatically populated","B"],["CSS","Easy","Which CSS property changes the text color?","font-style","background-color","color","text-decoration","C"],["CSS","Easy",'Which selector targets every element with class="card"?',"#card","card","*card",".card","D"],["CSS","Easy","Which CSS property changes the background color of an element?","color","background-color","font-color","text-color","B"],["CSS","Moderate","In a flex container with flex-direction: row, which property aligns items along the main axis?","align-items","justify-content","align-content","flex-wrap","B"],["CSS","Tough","A parent has position: relative. Its child has position: absolute; top: 10px; left: 20px. Assuming no intervening positioned ancestor, which box normally establishes the child's positioning reference?","The nearest positioned ancestor's padding box","The browser viewport in every case","The child's own margin box","The nearest sibling element","A"],["JavaScript","Easy","Which keyword declares a block-scoped variable that can be reassigned?","const","let","static","define","B"],["JavaScript","Easy","Which symbol is used for single-line comments in JavaScript?","<!-- -->","//","**","##","B"],["JavaScript","Easy","What is the output of console.log(5 + 3)?","53","2","8","15","C"],["JavaScript","Moderate","What does this code print? let x = 5; if (true) { let x = 10; } console.log(x);","10","undefined","A ReferenceError","5","D"],["JavaScript","Tough",'What is the output order? console.log("A"); setTimeout(() => console.log("B"), 0); Promise.resolve().then(() => console.log("C")); console.log("D");',"A, B, C, D","A, C, B, D","A, D, C, B","D, A, B, C","C"]];
const S=async k=>(await one('select value from settings where key=?',[k]))?.value;
let ready=null;
function init(){return ready||(ready=(async()=>{
 await db.executeMultiple(SCHEMA);
 await run("insert or ignore into settings(key,value) values('show_scores','0')");
 if(!(await one('select 1 x from administrators')))await run('insert into administrators(username,password_hash) values(?,?)',[process.env.ADMIN_USER||'kavya',bcrypt.hashSync(process.env.ADMIN_PASS||'kousar30',10)]);
 if(!(await one('select 1 x from quiz_questions')))await db.batch(QS.map((q,n)=>({sql:'insert into quiz_questions(id,question,option_a,option_b,option_c,option_d,correct_option,difficulty,category) values(?,?,?,?,?,?,?,?,?)',args:[n+1,q[2],q[3],q[4],q[5],q[6],q[7],q[1],q[0]]})),'write');
 let teams=process.env.TEAMS?process.env.TEAMS.split(',').map(x=>x.trim()).filter(Boolean):null;
 if(!teams){const f=path.join(__dirname,'teams.txt');teams=fs.existsSync(f)?fs.readFileSync(f,'utf8').split(/\r?\n/).map(x=>x.trim()).filter(Boolean):Array.from({length:+(process.env.TEAM_COUNT||60)},(_,i)=>String(i+1).padStart(2,'0'))}
 const have=new Set((await rows('select team_number from participants')).map(x=>x.team_number)),pre=process.env.PASS_PREFIX||'wizard',add=teams.filter(t=>!have.has(t));
 if(add.length)await db.batch(add.map(t=>({sql:'insert or ignore into participants(team_number,password_hash,created_at) values(?,?,?)',args:[t,bcrypt.hashSync(pre+t,8),Date.now()]})),'write');
})().catch(e=>{ready=null;throw e}))}
// ---- helpers
const now=()=>Date.now(),LIM=15*60*1000,A=f=>(q,r,n)=>Promise.resolve(f(q,r,n)).catch(n);
const rpGet=(p,n)=>one('select * from round_progress where participant_id=? and round_number=?',[p,n]);
async function rpSet(p,n,f){await run("insert or ignore into round_progress(participant_id,round_number,status) values(?,?,'not_started')",[p,n]);const k=Object.keys(f);await run(`update round_progress set ${k.map(x=>x+'=?').join(',')} where participant_id=? and round_number=?`,[...k.map(x=>f[x]),p,n])}
const sub=p=>one('select * from quiz_submissions where participant_id=?',[p]);
async function finalize(p,force){const s=await sub(p);if(!s||s.status!=='in_progress')return;const dl=s.started_at+LIM,exp=now()>dl;if(!force&&!exp)return;
 const end=exp?dl:now(),score=(await one('select count(*) c from quiz_responses r join quiz_questions q on q.id=r.question_id where r.participant_id=? and r.selected_option=q.correct_option',[p])).c,el=Math.round((end-s.started_at)/1000);
 const u=await run('update quiz_submissions set status=?,submitted_at=?,elapsed_seconds=?,score=? where participant_id=? and status=?',[exp?'timed_out':'submitted',end,el,score,p,'in_progress']);
 if(u.rowsAffected)await rpSet(p,3,{status:'completed',completed_at:end,elapsed_seconds:el})}
const limited=async k=>(await one('select count(*) c from login_fails where k=? and t>?',[k,now()-6e5])).c>=8,addFail=async k=>{await run('insert into login_fails(k,t) values(?,?)',[k,now()]);if(Math.random()<.05)await run('delete from login_fails where t<?',[now()-6e5])};
const str=(v,n=100)=>typeof v==='string'&&v.length>0&&v.length<=n?v.trim():null,same=(h,p)=>typeof p==='string'&&bcrypt.compareSync(p,h);
// ---- stateless signed-cookie sessions (works on serverless)
const SECRET=process.env.SESSION_SECRET||(process.env.VERCEL?null:'local-dev-secret-change-me'),SECURE=process.env.NODE_ENV==='production'||!!process.env.VERCEL;
const mac=b=>crypto.createHmac('sha256',SECRET).update(b).digest('base64url');
const sign=p=>{const b=Buffer.from(JSON.stringify(p)).toString('base64url');return b+'.'+mac(b)};
function readSession(q){const m=/(?:^|;\s*)ww=([^;]+)/.exec(q.headers.cookie||'');if(!m)return{};const[b,s]=m[1].split('.');if(!b||!s)return{};const e=mac(b);if(s.length!==e.length||!crypto.timingSafeEqual(Buffer.from(s),Buffer.from(e)))return{};try{const p=JSON.parse(Buffer.from(b,'base64url').toString());return p.exp>Date.now()?p:{}}catch{return{}}}
const setCookie=(r,v,age)=>r.setHeader('Set-Cookie',`ww=${v}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${SECURE?'; Secure':''}`);
// ---- app
const app=express();app.set('trust proxy',1);app.disable('x-powered-by');app.use(express.json({limit:'20kb'}));
app.use((q,r,n)=>{r.set({'Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Cache-Control':'no-store'});n()});
app.use('/api',A(async(q,r,n)=>{if(!SECRET)return r.status(500).json({error:'SESSION_SECRET is not configured.'});try{await init()}catch(e){console.error('init failed',e);return r.status(500).json({error:'Database connection failed. Check TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in Vercel, then redeploy.'})}q.session=readSession(q);n()}));
const needP=(q,r,n)=>q.session.role==='participant'?n():r.status(401).json({error:'Please log in.'});
const needA=(q,r,n)=>q.session.role==='admin'?n():r.status(401).json({error:'Admin access required.'});
const startSession=(r,o)=>{setCookie(r,sign({...o,exp:now()+864e5}),86400);r.json({ok:true,role:o.role})};
app.post('/api/login',A(async(q,r)=>{const t=str(q.body.username,50),p=str(q.body.password,100),k='l'+q.ip+(t||''),bad=async()=>{await addFail(k);return r.status(400).json({error:'Invalid username or password.'})};
 if(!t||!p)return r.status(400).json({error:'Enter your username and password.'});if(await limited(k))return r.status(429).json({error:'Too many attempts. Wait a few minutes.'});
 const a=await one('select * from administrators where username=?',[t]);if(a)return same(a.password_hash,p)?startSession(r,{role:'admin',aid:a.id}):bad();
 const u=await one('select * from participants where team_number=?',[t]);if(!u||!same(u.password_hash,p))return bad();
 await run("update participants set last_login=?,login_status='online' where id=?",[now(),u.id]);if(!await rpGet(u.id,3))await rpSet(u.id,3,{status:'entered'});startSession(r,{role:'participant',pid:u.id,team:u.team_number})}));
app.post('/api/logout',A(async(q,r)=>{if(q.session.pid)await run("update participants set login_status='offline' where id=?",[q.session.pid]);setCookie(r,'',0);r.json({ok:true})}));
app.get('/api/me',(q,r)=>r.json(q.session.role==='admin'?{role:'admin'}:q.session.role==='participant'?{role:'participant',team:q.session.team}:{role:null}));
// ---- quiz
const ans=async p=>Object.fromEntries((await rows('select question_id,selected_option from quiz_responses where participant_id=?',[p])).map(a=>[a.question_id,a.selected_option]));
async function quizState(p){await finalize(p);const s=await sub(p);if(!s)return{status:'not_started',minutes:15,now:now()};const o={status:s.status,started_at:s.started_at,deadline:s.started_at+LIM,now:now()};
 if(s.status==='in_progress'){o.questions=await rows('select id,question,option_a a,option_b b,option_c c,option_d d,category from quiz_questions order by id');o.answers=await ans(p)}
 else{o.submitted_at=s.submitted_at;if(await S('show_scores')==='1')o.score=s.score}return o}
app.get('/api/quiz',needP,A(async(q,r)=>r.json(await quizState(q.session.pid))));
app.post('/api/quiz/start',needP,A(async(q,r)=>{const p=q.session.pid;if(!await sub(p)){const t=now(),u=await run("insert or ignore into quiz_submissions(participant_id,started_at,status) values(?,?,'in_progress')",[p,t]);if(u.rowsAffected)await rpSet(p,3,{status:'in_progress',started_at:t})}r.json(await quizState(p))}));
const saveA=async(p,a)=>{const st=[];for(const[k,v]of Object.entries(a||{})){const n=+k;if(Number.isInteger(n)&&n>=1&&n<=15&&['A','B','C','D'].includes(v))st.push({sql:'insert into quiz_responses(participant_id,question_id,selected_option,updated_at) values(?,?,?,?) on conflict(participant_id,question_id) do update set selected_option=excluded.selected_option,updated_at=excluded.updated_at',args:[p,n,v,now()]})}if(st.length)await db.batch(st,'write')};
app.post('/api/quiz/save',needP,A(async(q,r)=>{const p=q.session.pid;await finalize(p);if((await sub(p))?.status!=='in_progress')return r.status(409).json({error:'The quiz is closed.',...await quizState(p)});await saveA(p,{[q.body.q]:q.body.option});r.json({ok:true,now:now()})}));
app.post('/api/quiz/submit',needP,A(async(q,r)=>{const p=q.session.pid;await finalize(p);if((await sub(p))?.status==='in_progress'){await saveA(p,q.body.answers);await finalize(p,true)}r.json(await quizState(p))}));
// ---- admin
const SEL='select p.id,p.team_number team,p.login_status,p.last_login,s.status s_status,s.started_at,s.submitted_at,s.elapsed_seconds,s.score,c.status c_status from participants p left join quiz_submissions s on s.participant_id=p.id left join round_progress c on c.participant_id=p.id and c.round_number=3';
const sum=x=>({id:x.id,team:x.team,login_status:x.login_status,last_login:x.last_login,quiz:{status:x.s_status||x.c_status||'not_started',started_at:x.started_at||null,submitted_at:x.submitted_at||null,elapsed:x.elapsed_seconds??null,score:x.s_status&&x.s_status!=='in_progress'?x.score:null}});
async function allSum(){for(const e of await rows("select participant_id from quiz_submissions where status='in_progress' and started_at<?",[now()-LIM]))await finalize(e.participant_id);return(await rows(SEL+' order by cast(p.team_number as integer),p.team_number')).map(sum)}
app.get('/api/admin/participants',needA,A(async(q,r)=>r.json({rows:await allSum(),settings:{show_scores:await S('show_scores')==='1'}})));
app.get('/api/admin/participants/:id',needA,A(async(q,r)=>{const id=+q.params.id;await finalize(id);const x=await one(SEL+' where p.id=?',[id]);if(!x)return r.status(404).json({error:'Not found.'});const s=sum(x);
 s.answers=await rows('select q.id,q.question,r.selected_option sel,q.correct_option correct from quiz_questions q left join quiz_responses r on r.question_id=q.id and r.participant_id=? order by q.id',[id]);r.json(s)}));
app.delete('/api/admin/participants/:id/attempt',needA,A(async(q,r)=>{const id=+q.params.id;if(!await one('select 1 x from participants where id=?',[id]))return r.status(404).json({error:'Not found.'});
 await db.batch(['quiz_responses','quiz_submissions','round_progress'].map(t=>({sql:`delete from ${t} where participant_id=?`,args:[id]})),'write');r.json({ok:true})}));
app.put('/api/admin/settings',needA,A(async(q,r)=>{await run("insert into settings(key,value) values('show_scores',?) on conflict(key) do update set value=excluded.value",[q.body.show_scores?'1':'0']);r.json({ok:true})}));
app.get('/api/admin/export.csv',needA,A(async(q,r)=>{const e=v=>{v=v==null?'':String(v);if(/^[=+\-@\t\r]/.test(v))v="'"+v;return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v},iso=t=>t?new Date(t).toISOString():'';
 const out=[['Team','Logged in','Quiz status','Started','Submitted','Seconds taken','Marks /15']];for(const s of await allSum())out.push([s.team,s.login_status,s.quiz.status,iso(s.quiz.started_at),iso(s.quiz.submitted_at),s.quiz.elapsed,s.quiz.score]);
 r.set({'Content-Type':'text/csv','Content-Disposition':'attachment; filename="web-wizard-results.csv"'}).send(out.map(x=>x.map(e).join(',')).join('\n'))}));
app.use('/api',(q,r)=>r.status(404).json({error:'Not found.'}));
app.use(express.static(path.join(__dirname,'public'),{maxAge:'1h'}));
app.use((e,q,r,n)=>{console.error(e);r.status(500).json({error:'Server error.'})});
module.exports=app;if(require.main===module)app.listen(process.env.PORT||3000,()=>console.log('WEB WIZARD on :'+(process.env.PORT||3000)));
