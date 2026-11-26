(()=>{
const base='https://sjtisywreewgaerqjrsi.supabase.co', apiKey='sb_publishable_oloZKU0yTJKT4WaJ8MDi9w_ZFIRkPdQ';
const $s=id=>document.getElementById(id), tokenKey='iron-log-social-session-v1';
let auth=null;try{auth=JSON.parse(localStorage.getItem(tokenKey))}catch{}
let current=null;
const say=t=>$s('socialStatus').textContent=t;
const store=a=>{auth=a;try{if(a)localStorage.setItem(tokenKey,JSON.stringify(a));else localStorage.removeItem(tokenKey)}catch{}};
async function request(path,options={},secure=true){
 const r=await fetch(base+path,{...options,headers:{apikey:apiKey,'Content-Type':'application/json',...(secure&&auth?.access_token?{Authorization:'Bearer '+auth.access_token}:{}),...options.headers}});
 const t=await r.text();let b;try{b=JSON.parse(t)}catch{b=t}
 if(!r.ok)throw Error(b?.msg||b?.message||b?.error_description||'Request failed ('+r.status+')');return b;
}
async function session(){if(!auth?.refresh_token)throw Error('Sign in first.');if(!auth.expires_at||auth.expires_at<Date.now()/1000+60){let a=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:auth.refresh_token})},false);store(a)}return auth}
const rest=async(path,o={})=>{await session();return request('/rest/v1/'+path,o)};
const rpc=(name,args)=>rest('rpc/'+name,{method:'POST',body:JSON.stringify(args)});
const guarded=fn=>async()=>{try{await fn()}catch(e){say(e.message)}};
function show(){let logged=!!auth?.user?.id;$s('socialLogin').hidden=logged;$s('socialMember').hidden=!logged;$s('socialIdentity').textContent=logged?'Signed in as '+(auth.user.user_metadata?.username||'Member'):'';if(logged&&!$s('socialName').value)$s('socialName').value=auth.user.user_metadata?.username||'';if(!logged){current=null;$s('socialBoard').replaceChildren()}}
let joining=false;
async function join(){if(joining)return;let username=$s('socialUsername').value.trim();if(!username||username.length>40)throw Error('Enter a username (1–40 characters).');joining=true;$s('socialSignIn').disabled=true;try{let a=await request('/auth/v1/signup',{method:'POST',body:JSON.stringify({data:{username}})},false);if(!a.access_token||!a.user?.id)throw Error('Could not create a member session.');store(a);show();say('Welcome, '+username+'! Your local workouts have not been uploaded.');await refresh()}finally{joining=false;$s('socialSignIn').disabled=false}}
$s('socialSignIn').onclick=guarded(join);
$s('socialSignOut').onclick=guarded(async()=>{if(!confirm('Leaving this membership may permanently remove access to your cloud backups and challenges. Export your workouts first. Continue?'))return;try{await session();await request('/auth/v1/logout',{method:'POST'})}finally{store(null);show();say('Signed out. Local workout data remains on this device.')}});
$s('socialBackup').onclick=guarded(async()=>{await session();if(!confirm('Upload this device’s workout history to your signed-in account, replacing its previous cloud backup?'))return;await rest('workout_backups?on_conflict=user_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({user_id:auth.user.id,payload:data,updated_at:new Date().toISOString()})});say('Cloud backup saved.')});
$s('socialRestore').onclick=guarded(async()=>{let rows=await rest('workout_backups?select=payload');if(!rows.length)throw Error('No cloud backup found.');let d=rows[0].payload;if(!Array.isArray(d.sets)||!Array.isArray(d.body)||!d.sets.every(s=>typeof s.id==='string'&&typeof s.date==='string'&&typeof s.split==='string'&&typeof s.exercise==='string'&&Number.isFinite(s.weight)&&s.weight>=0&&Number.isInteger(s.reps)&&s.reps>0&&typeof s.rir==='string'&&typeof s.notes==='string')||!d.body.every(b=>typeof b.date==='string'&&Number.isFinite(b.weight)&&b.weight>0))throw Error('Invalid backup.');if(confirm('Replace local workout data with your cloud backup? Export local data first if needed.')){data=d;save();say('Cloud backup restored.')}});
const name=()=>{let n=$s('socialName').value.trim();if(!n||n.length>40)throw Error('Enter a display name (1–40 characters).');return n};
$s('socialCreate').onclick=guarded(async()=>{let t=$s('socialTitle').value.trim(),e=$s('socialEnd').value;if(!t||!e)throw Error('Enter a challenge name and end date.');current=await rpc('create_challenge',{t,k:$s('socialKind').value,e,n:name()});await refresh();say('Challenge created. Share its invite code privately.')});
$s('socialJoin').onclick=guarded(async()=>{current=await rpc('join_challenge',{code:$s('socialCode').value.trim(),n:name()});await refresh();say('Challenge joined.')});
const labels={hydration:'Hydration goal',protein:'Protein goal',steps:'Step goal',workouts:'Workout consistency',streak:'Workout streak',strength:'Strength goal'};
function node(tag,value){let n=document.createElement(tag);n.textContent=value;return n}
async function refresh(){let list=await rest('challenges?select=id,title,kind,invite_code,starts_on,ends_on&order=starts_on.desc');let sel=$s('socialList');sel.replaceChildren();for(let c of list){let o=node('option',c.title+' • '+labels[c.kind]);o.value=c.id;sel.append(o)}if(!list.some(c=>c.id===current))current=list[0]?.id||null;sel.value=current||'';$s('socialDetails').hidden=!current;if(!current)return;let c=list.find(c=>c.id===current);$s('socialInvite').textContent=c.invite_code;$s('socialDates').textContent=c.starts_on+' through '+c.ends_on+' • self-reported daily goal completion';let members=await rest('challenge_members?select=user_id,display_name&challenge_id=eq.'+current);let scores=await rest('challenge_checkins?select=user_id,points,day&challenge_id=eq.'+current);let board=members.map(m=>({...m,points:scores.filter(s=>s.user_id===m.user_id).reduce((a,s)=>a+Number(s.points),0)})).sort((a,b)=>b.points-a.points);$s('socialBoard').replaceChildren(...board.map(m=>node('p',m.display_name+' — '+m.points+' goal days')))}
$s('socialList').onchange=guarded(async()=>{current=$s('socialList').value;await refresh()});$s('socialRefresh').onclick=guarded(refresh);
$s('socialCheck').onclick=guarded(async()=>{if(!current)throw Error('Choose a challenge.');await rpc('check_in',{cid:current,d:today(),p:1});await refresh();say('Today’s goal completion recorded. Extra intake earns no additional points.')});
$s('socialUndo').onclick=guarded(async()=>{if(!current)return;await rpc('check_in',{cid:current,d:today(),p:0});await refresh();say('Today’s check-in cleared.')});
$s('socialCopy').onclick=guarded(async()=>{await navigator.clipboard.writeText($s('socialInvite').textContent);say('Invite code copied.')});
$s('socialEnd').value=new Date(Date.now()+6*86400000).toISOString().slice(0,10);show();if(auth)guarded(refresh)();
})();