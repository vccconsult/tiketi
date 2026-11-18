"use strict";
const APP_V="28";   // същата като APP_VERSION в lib/server.js
const STD_STATUSES=[
  {k:"new",l:"Нов",c:"--st-blue"},{k:"work",l:"В работа",c:"--st-orange"},{k:"wait",l:"Чака клиент",c:"--st-red"},
  {k:"done",l:"Решен",c:"--st-green"}];
// Сервизни статуси = складови операции (SW – сервизен склад, MW – главен склад)
const REPAIR_STATUSES=[
  {k:"s0",code:"",l:"Регистриран",mv:"",c:"--st-grey"},
  {k:"s1300",code:"1300",l:"Получено дефектно у-во",mv:"+SW",c:"--st-blue"},
  {k:"s3400",code:"3400",l:"Повредено към Риека",mv:"-SW",c:"--st-red"},
  {k:"s1400",code:"1400",l:"Получено отремонтирано",mv:"+SW",c:"--st-orange"},
  {k:"s3300",code:"3300",l:"Ремонтирано към клиента",mv:"-SW",c:"--st-green"},
  {k:"s1401",code:"1401",l:"Връщане от Риека към гл. склад",mv:"+MW",c:"--st-green"},
  {k:"s3301",code:"3301",l:"Ново/заместващо към клиента",mv:"-MW",c:"--st-cyan"}];
// Заявки за отпуска (тикети към отдел „Управител“)
const LEAVE_STATUSES=[{k:"lv_wait",l:"Изчаква одобрение",c:"--st-orange"},{k:"lv_ok",l:"Одобрена",c:"--st-green"},{k:"lv_no",l:"Отказана",c:"--st-red"},{k:"lv_cancel",l:"Отменена",c:"--st-grey"}];
const LEGACY=[{k:"closed",l:"Затворен",c:"--st-grey"},{k:"received",l:"Прието",c:"--st-grey"},{k:"processed",l:"Обработено",c:"--st-grey"},{k:"sent",l:"Пратено на Риека",c:"--st-grey"},{k:"returned",l:"Върнато от Риека",c:"--st-grey"},{k:"stocked",l:"Заведено в склада",c:"--st-grey"}];
const STATUSES=[...STD_STATUSES,...REPAIR_STATUSES,...LEAVE_STATUSES,...LEGACY];
const CLOSED=new Set(["done","closed","s3300","s1401","stocked","lv_ok","lv_no","lv_cancel"]);
// Процедура: със замяна 1300 → 3301 → 3400 → 1401; без замяна 1300 → 3400 → 1400 → 3300
const REPAIR_PATH={yes:["s0","s1300","s3301","s3400","s1401"],no:["s0","s1300","s3400","s1400","s3300"]};
const DELTA={s0:{},s1300:{sw:1},s3400:{sw:-1},s1400:{sw:1},s3300:{sw:-1},s1401:{mw:1},s3301:{mw:-1}};
// Наличност по тикета: сбор от движенията до текущата операция
function balance(t){
  const path=REPAIR_PATH[t.replaced==="yes"?"yes":"no"],i=path.indexOf(t.status);
  if(i<0)return null;
  return path.slice(0,i+1).reduce((a,k)=>({sw:a.sw+(DELTA[k].sw||0),mw:a.mw+(DELTA[k].mw||0)}),{sw:0,mw:0});
}
const nextOp=t=>{const path=REPAIR_PATH[t.replaced==="yes"?"yes":"no"],i=path.indexOf(t.status);return i>=0&&i<path.length-1?path[i+1]:null};
// Какво чака ремонтът – с думи, по следващата операция от процедурата
const WAIT={s1300:"получаване на у-вото",s3301:"изписване на ново у-во към клиента",s3400:"изпращане към Риека",
  s1400:"отремонтираното от Риека",s1401:"връщане от Риека в гл. склад",s3300:"предаване на клиента"};
function waitHtml(t){
  if(t.kind!=="repair")return "";
  const n=nextOp(t);
  if(!n)return REPAIR_STATUSES.some(s=>s.k===t.status)?`<div class="wait done">✓ Приключен</div>`:"";
  const o=st(n);
  return `<div class="wait">Чака: ${WAIT[n]} <span class="mono">· ${o.code} ${o.mv}</span></div>${sentLine(t)}`;
}
// Колко дни е при Риека
const todayStr=()=>new Date(Date.now()-new Date().getTimezoneOffset()*6e4).toISOString().slice(0,10);
/* ---------- дати във формат ден.месец.година (може и с поставяне отвсякъде) ---------- */
const isoToBg=v=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(v||"");return m?`${m[3]}.${m[2]}.${m[1]}`:""};
function bgToIso(raw){
  let v=String(raw||"").trim().replace(/\s*(г\.?|год\.?|ч\..*)$/i,"").replace(/\s+\d{1,2}:\d{2}(:\d{2})?$/,"").trim();
  if(!v)return "";
  let y,mo,d,m;
  if((m=/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(v)))[y,mo,d]=[+m[1],+m[2],+m[3]];
  else if((m=/^(\d{1,2})\s*[-./,\\ ]\s*(\d{1,2})\s*[-./,\\ ]\s*(\d{2}|\d{4})$/.exec(v)))[d,mo,y]=[+m[1],+m[2],+m[3]];
  else if((m=/^(\d{2})(\d{2})(\d{4})$/.exec(v)))[d,mo,y]=[+m[1],+m[2],+m[3]];
  else if((m=/^(\d{2})(\d{2})(\d{2})$/.exec(v)))[d,mo,y]=[+m[1],+m[2],+m[3]];
  else if(/^\d{5}$/.test(v)){const t=new Date(Date.UTC(1899,11,30)+(+v)*864e5);return t.toISOString().slice(0,10)} // сериен номер от Excel
  else return null;
  if(y<100)y+=2000;
  const t=new Date(Date.UTC(y,mo-1,d));
  if(t.getUTCFullYear()!==y||t.getUTCMonth()!==mo-1||t.getUTCDate()!==d)return null;
  return t.toISOString().slice(0,10);
}
const CAL='<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M7 2a1 1 0 0 1 1 1v1h8V3a1 1 0 1 1 2 0v1h1a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h1V3a1 1 0 0 1 1-1Zm13 8H4v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-9Z"/></svg>';
const dateIn=(id,iso,max)=>`<span class="dt"><input id="${id}" class="dtin" type="text" inputmode="numeric" autocomplete="off" placeholder="дд.мм.гггг" value="${esc(isoToBg(iso))}" data-max="${esc(max||"")}"><button type="button" class="dtpick" tabindex="-1" aria-label="Избор от календар" title="Календар">${CAL}</button><input type="date" class="dtnative" tabindex="-1" aria-hidden="true" ${max?`max="${esc(max)}"`:""}></span>`;
// чете полето като ГГГГ-ММ-ДД; при грешна дата показва съобщение и връща null
function dval(sel,label){
  const el=$(sel);if(!el)return "";
  const iso=bgToIso(el.value);
  if(iso===null){el.classList.add("bad");el.focus();toast(`${label||"Датата"}: напишете я като ден.месец.година, напр. 25.03.2025`);return null}
  if(iso&&el.dataset.max&&iso>el.dataset.max){el.classList.add("bad");el.focus();toast(`${label||"Датата"} не може да е в бъдещето.`);return null}
  el.classList.remove("bad");return iso;
}
const dset=(sel,iso)=>{const el=$(sel);if(el){el.value=isoToBg(iso);el.classList.remove("bad")}};
const dtNorm=el=>{const iso=bgToIso(el.value);el.classList.toggle("bad",iso===null);if(iso)el.value=isoToBg(iso)};
document.addEventListener("focusout",e=>{if(e.target.classList&&e.target.classList.contains("dtin"))dtNorm(e.target)});
document.addEventListener("paste",e=>{const el=e.target;if(!el.classList||!el.classList.contains("dtin"))return;
  const txt=(e.clipboardData||window.clipboardData).getData("text").trim();const iso=bgToIso(txt);
  if(iso){e.preventDefault();el.value=isoToBg(iso);el.classList.remove("bad");el.dispatchEvent(new Event("input",{bubbles:true}))}});
document.addEventListener("input",e=>{if(e.target.classList&&e.target.classList.contains("dtin"))e.target.classList.remove("bad")});
document.addEventListener("click",e=>{const b=e.target.closest&&e.target.closest(".dtpick");if(!b)return;
  const box=b.parentElement,nat=box.querySelector(".dtnative"),txt=box.querySelector(".dtin");nat.value=bgToIso(txt.value)||"";
  try{nat.showPicker()}catch{nat.focus();nat.click()}});
document.addEventListener("change",e=>{if(e.target.classList&&e.target.classList.contains("dtnative")){const txt=e.target.parentElement.querySelector(".dtin");txt.value=isoToBg(e.target.value);txt.classList.remove("bad");txt.dispatchEvent(new Event("input",{bubbles:true}))}});
const daysSince=d=>Math.max(0,Math.round((new Date(todayStr())-new Date(d))/864e5));
const daysTxt=n=>n===0?"днес":n===1?"преди 1 ден":`преди ${n} дни`;
function sentLine(t){
  if(t.status!=="s3400"||!t.sentDate)return "";
  const n=daysSince(t.sentDate);
  return `<div class="sentl ${n>=30?"late":""}">Изпратено ${bgd(t.sentDate)} · ${n} ${n===1?"ден":"дни"}</div>`;
}
// Документът на текущата операция (от последния запис за нея)
function curDoc(t){
  const ev=(t.log||[]).slice().reverse().find(e=>(e.type==="status"&&e.to===t.status)||((e.type==="create"||e.type==="import")&&e.status===t.status));
  return ev&&ev.doc?ev.doc:"";
}
const bgd=s=>s?s.split("-").reverse().join("."):"";
const docLine=t=>{const d=curDoc(t);return d?`<div class="obj mono">док. № ${esc(d)}</div>`:""};
const sgn=v=>v>0?"+"+v:v<0?"−"+Math.abs(v):"0";
const balChip=(name,v,always)=>(v||always)?`<span class="bal ${v<0?"neg":v>0?"pos":"zero"}">${name} ${sgn(v)}</span>`:"";
const PRIOS=[{k:4,l:"Спешен",c:"--crit"},{k:3,l:"Висок",c:"--work"},{k:2,l:"Среден",c:"--new"},{k:1,l:"Нисък",c:"--st-grey"}];
const AVC=["#0d5c7a","#a0522d","#5b6b2f","#7a3d8c","#2f5f9e","#8a5a00","#3d6b6b"];

let absences=[], notifs=[], seenNotif=null, emailOn=false, me={id:"",name:"",isAdmin:false}, users=[], companies=[], tickets=[], departments=[], loaded=false, maxUsers=7;
const ui={view:"mine",open:"open",status:"",user:"",stock:"",openId:null};
try{const v=localStorage.getItem("tk_view");if(["mine","all","repairs","companies","calendar"].includes(v))ui.view=v}catch(e){}

const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const st=k=>STATUSES.find(s=>s.k===k)||STATUSES[0];
const pr=k=>PRIOS.find(p=>p.k===Number(k))||PRIOS[2];
const user=id=>users.find(u=>u.id===String(id));
const uname=id=>!id?"—":((user(id)||{}).name||"Изтрит потребител");
const comp=id=>companies.find(c=>c.id===String(id));
const cname=id=>(comp(id)||{}).name||"";
const team=()=>users.filter(u=>u.active);
const initials=n=>String(n||"?").trim().split(/\s+/).map(w=>w[0]).slice(0,2).join("").toUpperCase();
const fmt=iso=>{if(!iso)return"";const d=new Date(iso);return d.toLocaleDateString("bg-BG",{day:"2-digit",month:"2-digit",year:"numeric"})+" "+d.toLocaleTimeString("bg-BG",{hour:"2-digit",minute:"2-digit"})};
const tno=n=>"ТК-"+String(n||0).padStart(4,"0");
const isMine=t=>t.assignee===me.id;
const dept=id=>departments.find(d=>d.id===String(id));
const dname=id=>(dept(id)||{}).name||"";
const catsOf=id=>(dept(id)||{}).categories||[];
const myDept=()=>(user(me.id)||{}).department||"";
const membersOf=id=>team().filter(u=>u.department===String(id));
function av(id){if(!id)return"";return `<span class="av" style="background:${AVC[Number(id)%AVC.length]}">${esc(initials(uname(id)))}</span>`}
function pill(k){const s=st(k);return `<span class="pill solid" style="background:var(${s.c})">${s.code?`<b class="code">${s.code}</b>`:`<span class="dot"></span>`}${s.l}</span>`}
function prio(k){const p=pr(k);return `<span class="prio"><i style="background:var(${p.c})"></i>${p.l}</span>`}
function toast(msg){const t=$("#toast");t.textContent=msg;t.hidden=false;clearTimeout(toast.h);toast.h=setTimeout(()=>t.hidden=true,3200)}

/* ---------- server ---------- */
async function api(path,data){
  const opt=data===undefined?{headers:{"X-Tiketi-V":APP_V}}:{method:"POST",headers:{"Content-Type":"application/json","X-Tiketi":"1","X-Tiketi-V":APP_V},body:JSON.stringify(data)};
  const r=await fetch("/api/"+path,{...opt,credentials:"same-origin"});
  if(r.status===401){cacheClear();location.href="/login?expired=1";throw new Error("Сесията изтече.")}
  let j={};try{j=await r.json()}catch(e){}
  if(!r.ok||j.error)throw new Error(j.error||"Сървърът не отговори ("+r.status+").");
  return j;
}
// Първо зареждане – всичко; после само промените от последната проверка (пести четения от базата)
let cursor=null,refreshing=null;
function applyCfg(s){
  if(!s.users)return;
  me=s.me;emailOn=!!s.email;users=s.users;companies=s.companies;departments=s.departments||[];maxUsers=s.maxUsers;
}
function refresh(){ refreshing ||= doRefresh().finally(()=>refreshing=null); return refreshing; }
/* ---------- локално копие на данните (IndexedDB) ----------
   При отваряне на страницата данните се взимат от браузъра и от сървъра идват само промените.
   Така пълното зареждане (хиляди редове от базата) става рядко – пести дневния лимит на Cloudflare D1. */
let cacheTried=false,cacheTimer=null;
function idb(){return new Promise((res,rej)=>{const r=indexedDB.open("tiketi",1);r.onupgradeneeded=()=>r.result.createObjectStore("kv");r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function cacheGet(){try{const db=await idb();return await new Promise(res=>{const q=db.transaction("kv").objectStore("kv").get("state");q.onsuccess=()=>res(q.result||null);q.onerror=()=>res(null)})}catch(e){return null}}
function cacheSave(){
  if(!cursor||!loaded)return;
  clearTimeout(cacheTimer);
  cacheTimer=setTimeout(async()=>{try{const db=await idb();db.transaction("kv","readwrite").objectStore("kv").put({v:APP_V,uid:me.id,at:Date.now(),me,emailOn,users,companies,departments,maxUsers,tickets,absences,notifs,cursor},"state")}catch(e){}},800);
}
function cacheClear(){try{clearTimeout(cacheTimer);idb().then(db=>db.transaction("kv","readwrite").objectStore("kv").delete("state")).catch(()=>{})}catch(e){}}
// Нова версия на сървъра – презареждаме, но не и докато някой попълва формуляр
function checkVersion(v){
  if(!v||v===APP_V||!$("#drawer").hidden)return;
  try{const t=+sessionStorage.getItem("tk_reload")||0;if(Date.now()-t<10*60*1000)return;sessionStorage.setItem("tk_reload",String(Date.now()))}catch(e){}
  cacheClear();setTimeout(()=>location.reload(),300);
}
async function doRefresh(){
  try{
    if(!cursor&&!cacheTried){
      cacheTried=true;
      const c=await cacheGet();
      if(c&&c.v===APP_V&&c.cursor&&Date.now()-c.at<14*864e5){
        const d=await api("sync?"+new URLSearchParams({log:c.cursor.log,tomb:c.cursor.tomb,notif:c.cursor.notif,cfg:c.cursor.cfg,abs:c.cursor.abs||"0"}));
        checkVersion(d.v);
        if(!d.full&&d.u===c.uid){
          me=c.me;emailOn=c.emailOn;users=c.users;companies=c.companies;departments=c.departments;maxUsers=c.maxUsers;
          tickets=c.tickets;absences=c.absences||[];notifs=c.notifs||[];cursor=c.cursor;loaded=true;
          // нататък – като обикновена проверка за промени
          applySync(d);announce();render();renderBell();cacheSave();
          return;
        }
      }
    }
    if(cursor){
      const q=new URLSearchParams({log:cursor.log,tomb:cursor.tomb,notif:cursor.notif,cfg:cursor.cfg,abs:cursor.abs||"0"});
      const d=await api("sync?"+q);
      checkVersion(d.v);
      if(!d.full){
        if(applySync(d)){announce();render();renderBell();cacheSave()}
        return;
      }
    }
    const s=await api("state");
    checkVersion(s.v);
    applyCfg(s);tickets=s.tickets;absences=s.absences||[];notifs=s.notifications||[];cursor=s.cursor;loaded=true;$("#warn").hidden=true;
    announce();render();renderBell();cacheSave();
  }catch(e){const w=$("#warn");w.hidden=false;w.textContent=/лимит/.test(e.message)?e.message:"Няма връзка със сървъра: "+e.message}
}

// Прилага промените от /api/sync; връща true, ако нещо се е променило
function applySync(d){
  let changed=!!d.users;applyCfg(d);
  if(d.absences){absences=d.absences;changed=true}
  if(d.deleted&&d.deleted.length){const del=new Set(d.deleted);tickets=tickets.filter(t=>!del.has(t.id));changed=true}
  for(const t of d.tickets||[]){const i=tickets.findIndex(x=>x.id===t.id);if(i>=0)tickets[i]=t;else tickets.push(t);changed=true}
  if(d.notifications&&d.notifications.length){const have=new Set(notifs.map(n=>n.id));notifs=[...d.notifications.filter(n=>!have.has(n.id)),...notifs].slice(0,50);changed=true}
  cursor=d.cursor;$("#warn").hidden=true;
  return changed;
}

/* ---------- static filters ---------- */
$("#fPrio").innerHTML=`<option value="">Всички приоритети</option>`+PRIOS.map(p=>`<option value="${p.k}">${p.l}</option>`).join("");
["#q","#fPrio","#fCat","#fSort","#fComp","#fDept"].forEach(s=>$(s).addEventListener("input",render));
$("#cq").addEventListener("input",render);

/* ---------- view switching ---------- */
$("#views").addEventListener("click",e=>{const b=e.target.closest("[data-view]");if(!b)return;ui.view=b.dataset.view;ui.status="";ui.user="";ui.stock="";try{localStorage.setItem("tk_view",ui.view)}catch(e){}render()});
$("#segOpen").addEventListener("click",e=>{const b=e.target.closest("[data-open]");if(!b)return;ui.open=b.dataset.open;ui.status="";render()});
$("#whs").addEventListener("click",e=>{const b=e.target.closest("[data-stock]");if(!b)return;ui.stock=ui.stock===b.dataset.stock?"":b.dataset.stock;if(ui.stock){ui.status="";ui.open="any"}render()});
$("#stats").addEventListener("click",e=>{const b=e.target.closest("[data-s]");if(!b)return;ui.status=ui.status===b.dataset.s?"":b.dataset.s;if(ui.status)ui.open="any";render()});
function teamPick(e){const c=e.target.closest("[data-u]");if(!c)return;ui.user=ui.user===c.dataset.u?"":c.dataset.u;render()}
$("#team").addEventListener("click",teamPick);
$("#team").addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();teamPick(e)}});
$("#rows").addEventListener("click",e=>{const r=e.target.closest("tr[data-id]");if(r)openTicket(r.dataset.id)});
$("#rows").addEventListener("keydown",e=>{const r=e.target.closest("tr[data-id]");if(r&&e.key==="Enter")openTicket(r.dataset.id)});
$("#crows").addEventListener("click",e=>{const r=e.target.closest("tr[data-id]");if(r)openCompany(r.dataset.id)});
$("#crows").addEventListener("keydown",e=>{const r=e.target.closest("tr[data-id]");if(r&&e.key==="Enter")openCompany(r.dataset.id)});

/* ---------- render ---------- */
function scopeTickets(){return ui.view==="mine"?tickets.filter(isMine):ui.view==="repairs"?tickets.filter(t=>t.kind==="repair"):tickets}
function syncSelect(el,html,keep){const cur=el.value;el.innerHTML=html;el.value=keep(cur)?cur:""}
function render(){
  $("#meBox").innerHTML=`${av(me.id)}<span>${esc(me.name)}${me.isAdmin?" · админ":""}</span>`;
  const openAll=tickets.filter(t=>!CLOSED.has(t.status));
  $("#sub").textContent=loaded?`${tickets.length} тикета общо · ${openAll.length} отворени · ${openAll.filter(t=>!t.assignee).length} неразпределени · екип ${team().length}/${maxUsers}`:"Зареждане на данните…";
  $("#vcMine").textContent=loaded?openAll.filter(isMine).length:"";
  $("#vcAll").textContent=loaded?openAll.length:"";
  $("#vcComp").textContent=loaded?companies.length:"";
  const hasRep=repairDepts().length||tickets.some(t=>t.kind==="repair");
  $("#tabRep").hidden=!hasRep; if(!hasRep&&ui.view==="repairs")ui.view="all";
  $("#vcRep").textContent=loaded?openAll.filter(t=>t.kind==="repair").length:"";
  $("#btnNew").textContent=ui.view==="repairs"?"+ Нов ремонт":ui.view==="calendar"?"+ Отсъствие":"+ Нов тикет";
  const pend=absences.filter(a=>a.status==="pending");
  $("#vcCal").textContent=loaded&&isApprover()&&pend.length?pend.length:"";
  $("#btnImport").hidden=!(me.isAdmin&&ui.view==="repairs");
  document.querySelectorAll("#views [data-view]").forEach(b=>b.classList.toggle("on",b.dataset.view===ui.view));
  $("#btnExport").hidden=!tickets.length;
  const isComp=ui.view==="companies",isCal=ui.view==="calendar";
  $("#ticketsView").hidden=isComp||isCal;$("#companiesView").hidden=!isComp;$("#calView").hidden=!isCal;
  if(isComp){renderCompanies();return}
  if(isCal){renderCalendar();return}

  document.querySelectorAll("#segOpen [data-open]").forEach(b=>b.classList.toggle("on",b.dataset.open===ui.open));

  const isRep=ui.view==="repairs";
  const scope=scopeTickets();
  const cnt=k=>scope.filter(t=>t.status===k).length;
  if(ui.status&&!(isRep?REPAIR_STATUSES:STD_STATUSES).some(s=>s.k===ui.status))ui.status="";
  $("#fCat").hidden=isRep;
  $("#thead").innerHTML=isRep
    ?`<tr><th>№</th><th>Продукт / сериен №</th><th>Клиент</th><th>За замяна / склад</th><th>Статус</th><th>Отговорник</th><th>Приет</th></tr>`
    :`<tr><th>№</th><th>Проблем</th><th>Статус</th><th>Приоритет</th><th>Отговорник</th><th>Подал</th><th>Създаден</th></tr>`;
  $("#stats").classList.toggle("seven",isRep);$("#stats").classList.toggle("four",!isRep);
  // Състояние на складовете: колко у-ва са в сервизния склад и колко липсват от главния
  const whs=$("#whs"); whs.hidden=!isRep;
  if(isRep){
    let sw=0,mw=0,swN=0,mwN=0;
    for(const x of tickets){if(x.kind!=="repair")continue;const b=balance(x);if(!b)continue;sw+=b.sw;mw+=b.mw;if(b.sw>0)swN++;if(b.mw<0)mwN++}
    whs.innerHTML=`<button type="button" class="wh ${ui.stock==="sw"?"on":""}" data-stock="sw"><span class="whn">${sgn(sw)}</span><span class="whl"><b>SW · Сервизен склад</b>${swN?`${swN} ${swN===1?"у-во е":"у-ва са"} в сервиза`:"няма у-ва в сервиза"}</span></button>
      <button type="button" class="wh ${mw<0?"neg":""} ${ui.stock==="mw"?"on":""}" data-stock="mw"><span class="whn">${sgn(mw)}</span><span class="whl"><b>MW · Главен склад</b>${mwN?`${mwN} ${mwN===1?"заместващо у-во чака":"заместващи у-ва чакат"} връщане от Риека (1401)`:"няма липсващи у-ва"}</span></button>`;
  }
  $("#stats").innerHTML=(isRep?REPAIR_STATUSES:STD_STATUSES).map(s=>`<button type="button" class="stat ${ui.status===s.k?"on":""}" data-s="${s.k}" style="--sc:var(${s.c})"><span class="n">${loaded?cnt(s.k):"–"}</span><span class="l"><span class="dot" style="background:var(${s.c})"></span>${s.code?`${s.code} · ${s.mv}`:s.l}</span>${s.code?`<span class="sl">${s.l}</span>`:""}</button>`).join("");

  // filters kept in sync with data
  const fd=$("#fDept");
  syncSelect(fd,`<option value="">Всички отдели</option>`+(myDept()?`<option value="my">Моят отдел (${esc(dname(myDept()))})</option>`:"")
    +departments.map(d=>`<option value="${esc(d.id)}">${esc(d.name)}</option>`).join(""),v=>v==="my"?!!myDept():!!dept(v));
  const fdv=fd.value==="my"?myDept():fd.value;
  const allCats=[...new Set([...(fdv?catsOf(fdv):departments.flatMap(d=>d.categories)),...tickets.filter(x=>!fdv||x.department===fdv).map(x=>x.category).filter(Boolean)])];
  syncSelect($("#fCat"),`<option value="">Всички категории</option>`+allCats.map(c=>`<option>${esc(c)}</option>`).join(""),v=>allCats.includes(v));

  // team chips only in the shared view
  const t=$("#team");
  if(ui.view==="all"){
    t.hidden=false;
    const ord=team().filter(u=>!fdv||u.department===fdv).sort((a,b)=>(b.id===me.id)-(a.id===me.id));
    const inD=x=>!fdv||x.department===fdv;
    t.innerHTML=`<span class="lab">Отворени по отговорник</span>`
      +`<span class="chip unasg ${ui.user==="none"?"on":""}" role="button" tabindex="0" data-u="none"><span class="av">?</span>Неразпределени <span class="c">${openAll.filter(x=>!x.assignee&&inD(x)).length}</span></span>`
      +ord.map(u=>`<span class="chip ${ui.user===u.id?"on":""}" role="button" tabindex="0" data-u="${esc(u.id)}">${av(u.id)}${u.id===me.id?"Аз":esc(u.name)}${(()=>{const a=awayOn(u.id,todayStr());return a?` <span class="away" style="--ac:var(${atype(a.type).c})">${esc(atype(a.type).s)}</span>`:""})()} <span class="c">${openAll.filter(x=>x.assignee===u.id).length}</span></span>`).join("");
  }else t.hidden=true;

  // company filter options (kept in sync)
  const fc=$("#fComp"),cur=fc.value;
  fc.innerHTML=`<option value="">Всички компании</option>`+companies.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
  fc.value=comp(cur)?cur:"";
  comboize(fc,"Всички компании – търсете…").sync();

  const q=$("#q").value.trim().toLowerCase(), fp=$("#fPrio").value, fcat=$("#fCat").value, fco=fc.value, so=$("#fSort").value;
  let list=scope.filter(x=>
    (!isRep||!ui.stock||(()=>{const b=balance(x);return b&&(ui.stock==="sw"?b.sw>0:b.mw<0)})())
    &&(ui.status?x.status===ui.status:ui.open==="open"?!CLOSED.has(x.status):ui.open==="closed"?CLOSED.has(x.status):true)
    &&(ui.view!=="all"||!ui.user||(ui.user==="none"?!x.assignee:x.assignee===ui.user))
    &&(!fdv||x.department===fdv)
    &&(!fp||String(x.priority)===fp)&&(!fcat||x.category===fcat)&&(!fco||x.company===fco)
    &&(!q||[tno(x.no),x.title,x.description,cname(x.company),x.site,dname(x.department),x.clientName,x.product,x.serial,x.newSerial].join(" ").toLowerCase().includes(q)));
  const by={new:(a,b)=>b.no-a.no,old:(a,b)=>a.no-b.no,prio:(a,b)=>(b.priority-a.priority)||(b.no-a.no),upd:(a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))};
  list.sort(by[so]);
  const who=id=>id?`<span class="who">${av(id)}${id===me.id?"Аз":esc(uname(id))}</span>`:`<span class="unas">Неразпределен</span>`;
  if(isRep){
    $("#rows").innerHTML=list.map(x=>`<tr tabindex="0" data-id="${esc(x.id)}" style="--sc:var(${st(x.status).c})">
      <td class="no">${tno(x.no)}</td>
      <td><div class="ttl">${esc(x.product)}</div><div class="obj mono">SN ${esc(x.serial)}</div><div class="desc">${esc(x.description)}</div></td>
      <td>${esc(clientOf(x))||`<span class="note">—</span>`}${x.invoiceDate?`<div class="obj">фактура ${bgd(x.invoiceDate)}</div>`:""}</td>
      <td>${(()=>{const b=balance(x);return `${x.replaced==="yes"?`<span class="yes">Да</span>`:`<span class="note">Не</span>`}${b?`<div class="chips">${balChip("SW",b.sw,true)}${balChip("MW",b.mw,true)}</div>`:""}${x.replaced==="yes"?(x.issued?`<div class="issued">✓ ново изписано · 3301 № ${esc(x.issueDoc)}</div>`:""):""}`})()}</td>
      <td>${pill(x.status)}${docLine(x)}${waitHtml(x)}</td><td>${who(x.assignee)}</td><td class="date">${fmt(x.createdAt)}</td></tr>`).join("");
  }else
  $("#rows").innerHTML=list.map(x=>{if(x.kind==="repair"){const dc=[...new Set(["Ремонт",dname(x.department)].filter(Boolean))].join(" / ");return `<tr tabindex="0" data-id="${esc(x.id)}" style="--sc:var(${st(x.status).c})">
    <td class="no">${tno(x.no)}</td>
    <td><div class="ttl">${esc(x.title)}</div><div class="obj"><span class="dtag rtag">${esc(dc)}</span>${esc(clientOf(x))}</div><div class="desc">${esc(x.description)}</div></td>
    <td>${pill(x.status)}${waitHtml(x)}${(()=>{const b=balance(x);return b?`<div class="chips">${balChip("SW",b.sw,true)}${balChip("MW",b.mw,true)}</div>`:""})()}</td><td>${prio(x.priority)}</td><td>${who(x.assignee)}</td>
    <td><span class="who">${x.reporter===me.id?"Аз":esc(uname(x.reporter))}</span></td><td class="date">${fmt(x.createdAt)}</td></tr>`}
    const sub=[cname(x.company),x.site].filter(Boolean).join(" · ");const dc=[dname(x.department),x.category].filter(Boolean).join(" / ");return `<tr tabindex="0" data-id="${esc(x.id)}" style="--sc:var(${st(x.status).c})">
    <td class="no">${tno(x.no)}</td>
    <td><div class="ttl">${esc(x.title)}</div>${(sub||dc)?`<div class="obj">${dc?`<span class="dtag">${esc(dc)}</span>`:""}${esc(sub)}</div>`:""}<div class="desc">${esc(x.description)}</div></td>
    <td>${pill(x.status)}</td><td>${prio(x.priority)}</td>
    <td>${x.assignee?`<span class="who">${av(x.assignee)}${x.assignee===me.id?"Аз":esc(uname(x.assignee))}</span>`:`<span class="unas">Неразпределен</span>`}</td>
    <td><span class="who">${x.reporter===me.id?"Аз":esc(uname(x.reporter))}</span></td>
    <td class="date">${fmt(x.createdAt)}</td></tr>`}).join("");
  const em=$("#empty");
  if(!loaded){em.hidden=false;em.innerHTML="<b>Зареждане на тикетите…</b>"}
  else if(isRep&&!scope.length){em.hidden=false;em.innerHTML="<b>Още няма ремонти</b>Натиснете „+ Нов ремонт“, за да приемете първото устройство."}
  else if(!tickets.length){em.hidden=false;em.innerHTML="<b>Все още няма тикети</b>Натиснете „+ Нов тикет“, за да опишете първия проблем."}
  else if(!list.length){em.hidden=false;em.innerHTML=ui.view==="mine"&&!scope.length?"<b>Нямате възложени тикети</b>Тук се показват тикетите, които сте поели или са прехвърлени към вас. Свободните тикети на отдела са в „Общи тикети“.":"<b>Няма тикети по тези филтри</b>Сменете „Отворени / Затворени“, изчистете търсенето или изберете друг статус."}
  else em.hidden=true;
}

function renderCompanies(){
  const q=$("#cq").value.trim().toLowerCase();
  const list=companies.filter(c=>!q||[c.name,c.eik,c.city,c.contact_person,c.phone,c.email,c.address].join(" ").toLowerCase().includes(q));
  $("#crows").innerHTML=list.map(c=>{const ts=tickets.filter(t=>t.company===c.id);return `<tr tabindex="0" data-id="${esc(c.id)}">
    <td><div class="cname">${esc(c.name)}</div>${(c.city||c.address)?`<div class="obj">${esc([c.city,c.address].filter(Boolean).join(", "))}</div>`:""}</td>
    <td>${esc(c.contact_person)||`<span class="note">—</span>`}</td>
    <td>${esc(c.phone)||`<span class="note">—</span>`}</td>
    <td class="no">${esc(c.eik)}</td>
    <td class="num">${ts.filter(t=>!CLOSED.has(t.status)).length}</td><td class="num">${ts.length}</td></tr>`}).join("");
  const em=$("#cempty");
  if(!companies.length){em.hidden=false;em.innerHTML="<b>Още няма компании</b>Добавете клиентите си с „+ Нова компания“. После ги избирате при нов тикет."}
  else if(!list.length){em.hidden=false;em.innerHTML="<b>Няма намерени компании</b>Опитайте с друга дума."}
  else em.hidden=true;
}

/* ---------- търсене във фирмите по част от името ---------- */
const norm=x=>String(x||"").toLowerCase().replace(/[„“”"'«»]/g,"").replace(/\s+/g," ").trim();
function comboize(sel,placeholder){
  if(!sel||sel.dataset.combo)return sel&&sel._combo;
  sel.dataset.combo="1";sel.hidden=true;
  const box=document.createElement("div");box.className="combo";
  box.innerHTML=`<input type="text" class="combo-in" autocomplete="off" spellcheck="false" placeholder="${esc(placeholder||"Търсете по част от името…")}" role="combobox" aria-expanded="false"><ul class="combo-list" role="listbox" hidden></ul>`;
  sel.after(box);
  const inp=box.querySelector("input"),ul=box.querySelector("ul");let items=[],act=-1;
  const curText=()=>{const o=sel.selectedOptions[0];return o&&o.value?o.textContent:""};
  const sync=()=>{if(document.activeElement!==inp)inp.value=curText()};
  const close=()=>{ul.hidden=true;inp.setAttribute("aria-expanded","false");act=-1};
  const draw=()=>{
    const q=norm(inp.value===curText()?"":inp.value),words=q.split(" ").filter(Boolean);
    items=[...sel.options].filter(o=>!words.length||words.every(w=>norm(o.textContent).includes(w))).slice(0,60);
    ul.innerHTML=items.length?items.map((o,i)=>`<li role="option" data-i="${i}" class="${o.value===sel.value?"cur":""} ${o.value?"":"none"}">${esc(o.textContent)}</li>`).join(""):`<li class="empty">Няма фирма с „${esc(inp.value)}“</li>`;
    ul.hidden=false;inp.setAttribute("aria-expanded","true");act=-1;
  };
  const pick=i=>{const o=items[i];if(!o)return;sel.value=o.value;inp.value=o.value?o.textContent:"";close();sel.dispatchEvent(new Event("change",{bubbles:true}));sel.dispatchEvent(new Event("input",{bubbles:true}))};
  const hi=()=>ul.querySelectorAll("li[data-i]").forEach((li,i)=>{li.classList.toggle("act",i===act);if(i===act)li.scrollIntoView({block:"nearest"})});
  inp.addEventListener("focus",()=>{inp.select();draw()});
  inp.addEventListener("input",draw);
  inp.addEventListener("keydown",e=>{
    if(e.key==="ArrowDown"){e.preventDefault();if(ul.hidden)draw();act=Math.min(act+1,items.length-1);hi()}
    else if(e.key==="ArrowUp"){e.preventDefault();act=Math.max(act-1,0);hi()}
    else if(e.key==="Enter"){if(!ul.hidden){e.preventDefault();pick(act>=0?act:0)}}
    else if(e.key==="Escape"&&!ul.hidden){e.stopPropagation();close();inp.value=curText()}
  });
  ul.addEventListener("mousedown",e=>{const li=e.target.closest("li[data-i]");if(li){e.preventDefault();pick(+li.dataset.i)}});
  inp.addEventListener("blur",()=>setTimeout(()=>{close();inp.value=curText()},120));
  sel._combo={sync,input:inp};sync();
  return sel._combo;
}

/* ---------- drawer helpers ---------- */
function showDrawer(html){$("#drawer").innerHTML=html;$("#drawer").hidden=false;$("#scrim").hidden=false;$("#drawer").querySelectorAll("[data-x]").forEach(b=>b.onclick=closeDrawer);$("#drawer").querySelector(".db").scrollTop=0;const f=$("#drawer").querySelector("input:not([type=hidden]),textarea,select");f&&f.focus({preventScroll:true})}
function closeDrawer(){$("#drawer").hidden=true;$("#scrim").hidden=true;ui.openId=null}
$("#scrim").addEventListener("click",closeDrawer);
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("#drawer").hidden)closeDrawer()});
// Служители, групирани по отдели. withQueues добавя „Целия отдел“ (d:ID) към всяка група.
function targetOpts(withQueues){
  const pe=u=>`<option value="u:${esc(u.id)}">${esc(u.name)}${u.id===me.id?" (аз)":""}</option>`;
  const nod=team().filter(u=>!dept(u.department));
  return departments.map(d=>`<optgroup label="${esc(d.name)}">${withQueues?`<option value="d:${esc(d.id)}">Целия отдел ${esc(d.name)} (без конкретен човек)</option>`:""}${membersOf(d.id).map(pe).join("")}</optgroup>`).join("")
    +(nod.length?`<optgroup label="Без отдел">${nod.map(pe).join("")}</optgroup>`:"");
}
const deptOpts=sel=>(departments.length?"":`<option value="">— няма отдели —</option>`)+departments.map(d=>`<option value="${esc(d.id)}" ${d.id===sel?"selected":""}>${esc(d.name)}</option>`).join("")
  +(sel&&!dept(sel)?`<option value="" selected>— без отдел —</option>`:"");
function catOpts(did,sel){
  const list=catsOf(did).length?catsOf(did):["Друго"];
  return (sel&&!list.includes(sel)?`<option selected>${esc(sel)}</option>`:"")+list.map(c=>`<option ${c===sel?"selected":""}>${esc(c)}</option>`).join("");
}
const compOpts=sel=>`<option value="">— без компания —</option>`+companies.map(c=>`<option value="${esc(c.id)}" ${c.id===sel?"selected":""}>${esc(c.name)}</option>`).join("");
const TABS=`<div class="tabs" role="group" aria-label="Филтър на историята"><button type="button" class="on" data-hf="all">Всичко</button><button type="button" data-hf="note">Бележки</button><button type="button" data-hf="chg">Промени</button></div>`;
function tabsBind(h){h.querySelector(".tabs").addEventListener("click",e=>{const b=e.target.closest("[data-hf]");if(!b)return;h.dataset.f=b.dataset.hf;h.querySelectorAll("[data-hf]").forEach(x=>x.classList.toggle("on",x===b))})}
function compInfo(id){
  const c=comp(id);if(!c)return"";
  const rows=[["Контакт",c.contact_person],["Телефон",c.phone],["Имейл",c.email],["Адрес",[c.city,c.address].filter(Boolean).join(", ")],["Договор",c.contract]].filter(r=>r[1]);
  return rows.length?`<dl class="cinfo">${rows.map(r=>`<dt>${r[0]}</dt><dd>${esc(r[1])}</dd>`).join("")}</dl>`:"";
}
const sitesOf=id=>{const c=comp(id);return c?String(c.sites||"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean):[]};

/* ---------- ticket drawer ---------- */
const isRepairDept=id=>(dept(id)||{}).form==="repair";
const repairDepts=()=>departments.filter(d=>d.form==="repair");
const clientOf=t=>cname(t.company)||t.clientName||"";
function statusOpts(kind,sel,repl){
  if(kind!=="repair")return STD_STATUSES.map(s=>`<option value="${s.k}" ${s.k===sel?"selected":""}>${s.l}</option>`).join("");
  // Нов ремонт – само 1300; после – операциите от процедурата за замяна / без замяна
  let keys=!repl?["s0"]:[...REPAIR_PATH[repl==="yes"?"yes":"no"]];
  if(sel&&!keys.includes(sel))keys=[sel,...keys];
  return keys.map(k=>{const s=st(k);return `<option value="${k}" ${k===sel?"selected":""}>${s.code?`${s.code} · ${s.l} (${s.mv})`:k==="s0"?"Регистриран (без складово движение)":`${s.l} (стар статус)`}</option>`}).join("");
}
const productList=()=>[...new Set(tickets.filter(x=>x.kind==="repair"&&x.product).map(x=>x.product))].sort((a,b)=>a.localeCompare(b,"bg"));

// Бележките под описанието – по реда, в който са писани
function noteItem(ev){
  return `<div class="nitem"><div class="nmeta">${av(ev.by)}<b>${ev.by===me.id?"Аз":esc(uname(ev.by))}</b><span>${fmt(ev.at)}</span></div><div class="ntext">${esc(ev.text)}</div></div>`;
}
function threadInner(t){
  const notes=(t.log||[]).filter(e=>e.type==="note");
  return `<div class="nhead">Бележки${notes.length?` (${notes.length})`:""}</div>
    ${notes.map(noteItem).join("")}
    <div class="nnew"><textarea id="t_note" placeholder="${notes.length?"Следваща бележка…":"Първа бележка: какво е направено, отговор на клиента…"}"></textarea>
    <div class="nbar"><span class="note">Ctrl+Enter добавя бележката</span><button type="button" id="addNote">Добави бележка</button></div></div>`;
}
const threadHtml=t=>`<div class="thread" id="thread">${threadInner(t)}</div>`;
function changesHtml(t){
  const ch=(t.log||[]).filter(e=>e.type!=="note");
  return `<details class="hist" id="hist" ${ch.length<=6?"open":""}><summary><h3>История на промените (${ch.length})</h3></summary>
    <div class="tl">${ch.slice().reverse().map(ev=>evHtml(ev)).join("")||`<div class="note">Още няма записи.</div>`}</div></details>`;
}

function stockPanel(t){
  const b=balance(t);if(!b)return "";
  const n=nextOp(t),ns=n&&st(n),repl=t.replaced==="yes";
  const why=repl
    ?(t.status==="s0"?"Регистриран – още няма складово движение. При получаване на у-вото: 1300 (+SW).":b.mw<0?"MW е на −1: заместващото у-во е изписано от главния склад. Връща се на 0 с операция 1401, когато отремонтираното дойде от Риека.":t.status==="s1300"?"За замяна: следва изписване на ново/заместващо у-во от главния склад (3301).":"")
    :(t.status==="s0"?"Регистриран – още няма складово движение. При получаване на у-вото: 1300 (+SW).":b.mw===0&&!CLOSED.has(t.status)?"Без замяна – главният склад не се променя. Отремонтираното у-во от Риека отива при клиента.":"");
  return `<div class="stock">
    <div class="srow"><span class="lab">Наличност по ремонта</span><span class="chips">${balChip("SW",b.sw,true)}${balChip("MW",b.mw,true)}</span></div>
    ${why?`<div class="swhy">${why}</div>`:""}
    ${n?`<div class="snext"><span>Чака: <b>${WAIT[n]}</b> – операция <b>${ns.code} ${esc(ns.l)}</b> <span class="mono">(${ns.mv})</span></span><button type="button" id="r_next" data-op="${n}">Избери</button></div>`
      :`<div class="sdone">✓ Процедурата е завършена.</div>`}
  </div>`;
}
function ticketForm(t,preset){
  const isNew=!t;
  const defDept=(preset&&preset.department)||myDept()||(departments[0]||{}).id||"";
  t=t||{status:"",priority:2,category:"",reporter:me.id,assignee:"",company:"",site:"",department:defDept,clientName:"",product:"",serial:"",replaced:"",newSerial:"",issued:false,issueDoc:"",...(preset||{})};
  const kind=isNew?(isRepairDept(t.department)?"repair":"ticket"):(t.kind||"ticket");
  const word=kind==="repair"?"ремонт":"тикет";
  const asgBlock=isNew
    ?`<div class="asg"><span class="lab">Насочи към</span>
        <select id="t_asg"><option value="">Свободен в отдела (без отговорник)</option>${targetOpts(false)}</select></div>`
    :`<div class="asg"><div class="row">
        <div><div class="lab">Отговорник${dname(t.department)?" · отдел "+esc(dname(t.department)):""}</div><div class="cur">${t.assignee?`${av(t.assignee)}${esc(uname(t.assignee))}${t.assignee===me.id?" (аз)":""}`:`<span class="unas">Свободен – чака някой от отдела да го поеме</span>`}</div></div>
        <div class="btns">${t.assignee!==me.id?`<button type="button" id="btnTake">Поеми</button>`:""}<button type="button" id="btnTrf">Прехвърли…</button></div></div>
        <div class="trf" id="trf" hidden>
          <label class="f">Прехвърли към<select id="trf_to"><option value="__">Изберете служител или отдел…</option>${t.assignee?`<option value="">Освободи – остава свободен в отдела</option>`:""}${targetOpts(true)}</select></label>
          <div class="btns"><button type="button" class="primary" id="trfGo">Прехвърли</button><button type="button" id="trfNo">Отказ</button></div>
        </div></div>`;
  const yn=v=>`<div class="seg yn" role="radiogroup" aria-label="За замяна">
      <label><input type="radio" name="t_repl" value="yes" ${v==="yes"?"checked":""}><span>Да</span></label>
      <label><input type="radio" name="t_repl" value="no" ${v==="no"?"checked":""}><span>Не</span></label></div>`;
  const stdFields=`<div id="f_std" class="stack" ${kind==="repair"?"hidden":""}>
      <label class="f"><span>Заглавие <span class="req">*</span></span><input id="t_title" maxlength="140" value="${esc(kind==="repair"?"":t.title||"")}" placeholder="Напр. Централата не се включва под охрана"></label>
      <label class="f"><span>Описание на проблема <span class="req">*</span></span><textarea id="t_desc" placeholder="Какво се случва, от кога, кои зони или камери, кодове на грешки, какво е опитано досега…">${esc(kind==="repair"?"":t.description||"")}</textarea></label>
      ${!isNew&&kind!=="repair"?threadHtml(t)+filesHtml(t):""}
      ${isNew?`<div class="files"><div class="nhead">Файлове</div><label class="fdrop"><input type="file" id="t_newfiles" multiple hidden><b>+ Прикачи файлове</b><span class="note" id="t_newfiles_l">ще се качат след създаването · до 10 MB всеки</span></label></div>`:""}
      <div class="g2">
        <label class="f">Компания<select id="t_comp">${compOpts(t.company)}</select></label>
        <label class="f">Обект<input id="t_site" maxlength="160" list="t_sites" value="${esc(t.site||"")}" placeholder="Напр. Склад Плевен"><datalist id="t_sites"></datalist></label>
      </div>
      <div class="t_cinfo">${kind==="repair"?"":compInfo(t.company)}</div>
      <label class="f">Категория<select id="t_cat">${catOpts(t.department,t.category)}</select></label>
    </div>`;
  const locked=!isNew&&kind==="repair";
  const yesno=v=>v==="yes"?"Да":v==="no"?"Не":"—";
  const summary=locked?`<div class="rsum" id="r_sum">
      <dl>
        <dt>Клиент</dt><dd>${esc(clientOf(t))||"—"}</dd>
        <dt>Продукт</dt><dd>${esc(t.product)}</dd>
        <dt>Сериен №</dt><dd class="mono">${esc(t.serial)}</dd>
        <dt>Дата по фактура</dt><dd>${t.invoiceDate?bgd(t.invoiceDate):`<span class="note">—</span>`}</dd>
        <dt>Повреда</dt><dd class="pre">${esc(t.description)}</dd>
        <dt>За замяна</dt><dd>${t.replaced==="yes"?`<span class="yes">Да</span>`:yesno(t.replaced)}</dd>
      </dl>
      <div class="rsum-bar"><span class="note">Данните от приемането са заключени.</span>${me.isAdmin?`<button type="button" id="r_unlock">Поправи данните</button>`:""}</div>
    </div>`:"";
  const repFields=`<div id="f_rep" class="stack repform" ${kind==="repair"?"":"hidden"}>
      ${summary}
      <div id="r_intake" class="stack" ${locked?"hidden":""}>
      <div class="g2">
        <label class="f"><span>Клиент <span class="req">*</span></span><select id="r_comp">${compOpts(t.company).replace("— без компания —","— друг клиент (напишете) —")}</select></label>
        <label class="f" id="r_cname_box" ${t.company?"hidden":""}>Име на клиента<input id="r_cname" maxlength="160" value="${esc(t.clientName||"")}" placeholder="Напр. Иван Петров, 0888 …"></label>
      </div>
      <div class="t_cinfo">${kind==="repair"?compInfo(t.company):""}</div>
      <div class="g2">
        <label class="f"><span>Продукт <span class="req">*</span></span><input id="r_product" maxlength="120" list="r_products" value="${esc(t.product||"")}" placeholder="Напр. Ajax Hub 2 Plus"><datalist id="r_products">${productList().map(x=>`<option value="${esc(x)}">`).join("")}</datalist></label>
        <label class="f"><span>Сериен номер <span class="req">*</span></span><input id="r_serial" class="mono" maxlength="80" value="${esc(t.serial||"")}" autocapitalize="characters" spellcheck="false"></label>
      </div>
      <div class="g2">
        <label class="f">Дата по фактура${dateIn("r_invdate",t.invoiceDate,todayStr())}</label>
      </div>
      <label class="f"><span>Повреда <span class="req">*</span></span><textarea id="r_fault" placeholder="Какво не работи, как се проявява, кога е започнало…">${esc(kind==="repair"?t.description||"":"")}</textarea></label>
      <div class="g2">
        <div class="f"><span class="flab">За замяна <span class="req">*</span></span>${yn(t.replaced)}</div>
      </div>
      </div>
      ${locked?stockPanel(t):""}
      ${locked&&t.status==="s3400"?`<div class="sentbox">
        <div class="sb-h">Изпратено към Риека</div>
        <div class="sb-row"><span class="sb-big">${t.sentDate?bgd(t.sentDate):"—"}</span>${t.sentDate?`<span class="sb-days ${daysSince(t.sentDate)>=30?"late":""}">${daysTxt(daysSince(t.sentDate))}</span>`:""}${curDoc(t)?`<span class="note">документ № <span class="mono">${esc(curDoc(t))}</span></span>`:""}</div>
        <label class="f">Дата на изпращане${dateIn("r_sentedit",t.sentDate,todayStr())}</label>
        <div class="note">Чака връщане от Риека. Поправката на датата се записва с „Запази промените“.</div>
      </div>`:""}
      ${t.issued?`<div class="issued big">✓ Ново/заместващо у-во изписано към клиента · операция 3301 · документ № ${esc(t.issueDoc)}${t.newSerial?` · SN <span class="mono">${esc(t.newSerial)}</span>`:""}</div>`:""}
    </div>`;
  return `<div class="dh"><h2>${isNew?`<span id="t_head">Нов ${word}</span>`:`<span class="no">${tno(t.no)}</span> ${esc(t.title)}`}</h2><button type="button" data-x aria-label="Затвори">✕</button></div>
  <form class="db" id="tf" data-kind="${kind}">
    ${isNew?"":`<div class="meta">${kind==="repair"?"Приет":"Създаден"} ${fmt(t.createdAt)} от ${esc(uname(t.reporter))} · Обновен ${fmt(t.updatedAt)}</div>`}
    ${asgBlock}
    <label class="f">Отдел<select id="t_dept">${deptOpts(t.department)}</select></label>
    ${isNew&&repairDepts().length?`<div class="note" id="t_kindnote">${kind==="repair"?"Отделът е със сервизна бланка за ремонт.":"Изберете сервизен отдел, за да попълните бланка за ремонт."}</div>`:""}
    ${stdFields}
    ${repFields}
    <div class="g2">
      <label class="f">Приоритет<select id="t_prio">${PRIOS.map(p=>`<option value="${p.k}" ${p.k===Number(t.priority)?"selected":""}>${p.l}</option>`).join("")}</select></label>
      <label class="f">${kind==="repair"?"Статус (складова операция)":"Статус"}<select id="t_status">${statusOpts(kind,t.status||(kind==="repair"?"s0":""),isNew?"":t.replaced)}</select></label>
    </div>
    <div class="issue" id="r_op" hidden>
      <div class="g2">
        <label class="f"><span id="r_sdoc_lab">Документ №</span><input id="r_sdoc" class="mono" maxlength="60" placeholder="Номер на складовия документ"></label>
        <label class="f" id="r_sent_box" hidden>Дата на изпращане${dateIn("r_sentdate","",todayStr())}</label>
        <label class="f" id="r_nsn_box" hidden>Сериен № на новото у-во<input id="r_newserial" class="mono" maxlength="80" spellcheck="false"></label>
      </div>
    </div>
    ${!isNew&&kind==="repair"?threadHtml(t):""}
    ${isNew?"":changesHtml(t)}
  </form>
  <div class="df">${(!isNew&&(t.reporter===me.id||me.isAdmin))?`<button type="button" class="danger" id="delT">Изтрий</button>`:""}<div class="r"><button type="button" data-x>Отказ</button><button type="button" class="primary" id="saveT">${isNew?`Създай ${word}`:"Запази промените"}</button></div></div>`;
}
function openNew(preset){
  preset=preset||{};
  if(!preset.department&&ui.view==="repairs"){const r=repairDepts();if(r.length)preset.department=(r.find(d=>d.id===myDept())||r[0]).id}
  ui.openId=null;showDrawer(ticketForm(null,preset));bindForm(null);
}
function openTicket(id){const t=tickets.find(x=>x.id===String(id));if(!t)return;ui.openId=t.id;if(t.kind==="leave"){openLeave(t);return}showDrawer(ticketForm(t));bindForm(t)}
function bindForm(t){
  const isNew=!t;
  const kindNow=()=>$("#tf").dataset.kind;
  $("#saveT").onclick=()=>saveTicket(t);
  $("#tf").addEventListener("submit",e=>e.preventDefault());
  // standard
  const fillSites=()=>{$("#t_sites").innerHTML=sitesOf($("#t_comp").value).map(s=>`<option value="${esc(s)}">`).join("")};
  fillSites();
  comboize($("#t_comp"),"Търсете компания по част от името…");comboize($("#r_comp"),"Търсете клиент по част от името…");
  $("#t_comp").addEventListener("change",()=>{$("#f_std .t_cinfo").innerHTML=compInfo($("#t_comp").value);fillSites();const s=sitesOf($("#t_comp").value);if(s.length===1&&!$("#t_site").value)$("#t_site").value=s[0]});
  const fillCats=()=>{$("#t_cat").innerHTML=catOpts($("#t_dept").value,t&&t.department===$("#t_dept").value?t.category:"")};
  // repair
  $("#r_comp").addEventListener("change",()=>{const v=$("#r_comp").value;$("#r_cname_box").hidden=!!v;$("#f_rep .t_cinfo").innerHTML=compInfo(v)});
  // Документ № се пита при всяка нова складова операция; за 3301 е задължителен
  const syncOp=()=>{
    const v=$("#t_status").value,o=REPAIR_STATUSES.find(x=>x.k===v);
    const show=kindNow()==="repair"&&!!o&&!!o.code&&!!t&&t.status!==v;
    $("#r_op").hidden=!show;
    if(!show)return;
    const must=v==="s3301";
    $("#r_sdoc_lab").innerHTML=`Документ № за операция ${o.code} (${o.mv})${must?' <span class="req">*</span>':" – по желание"}`;
    $("#r_nsn_box").hidden=!must;
    const sb=$("#r_sent_box");sb.hidden=v!=="s3400";if(v==="s3400"&&!$("#r_sentdate").value)dset("#r_sentdate",todayStr());
  };
  syncOp();
  const ul=$("#r_unlock"); if(ul) ul.onclick=()=>{$("#r_sum").hidden=true;$("#r_intake").hidden=false;$("#r_product").focus()};
  $("#t_status").addEventListener("change",()=>{syncOp();if(!$("#r_op").hidden)$("#r_sdoc").focus()});
  const nx=$("#r_next"); if(nx) nx.onclick=()=>{$("#t_status").value=nx.dataset.op;syncOp();$("#t_status").scrollIntoView({block:"center"});$("#r_sdoc").focus()};
  // switching department may switch the form (only for new)
  const applyKind=()=>{
    if(!isNew)return;
    const k=isRepairDept($("#t_dept").value)?"repair":"ticket";
    if(k===kindNow())return;
    $("#tf").dataset.kind=k;$("#f_std").hidden=k==="repair";$("#f_rep").hidden=k!=="repair";
    $("#t_status").innerHTML=statusOpts(k,k==="repair"?"s0":"","");syncOp();
    const word=k==="repair"?"ремонт":"тикет";$("#t_head").textContent="Нов "+word;$("#saveT").textContent="Създай "+word;
    const n=$("#t_kindnote");if(n)n.textContent=k==="repair"?"Отделът е със сервизна бланка за ремонт.":"Изберете сервизен отдел, за да попълните бланка за ремонт.";
  };
  $("#t_dept").addEventListener("change",()=>{fillCats();applyKind()});
  const ta=$("#t_asg"); if(ta) ta.addEventListener("change",()=>{const u=user(ta.value.slice(2));if(u&&dept(u.department)&&$("#t_dept").value!==u.department){$("#t_dept").value=u.department;fillCats();applyKind()}});
  bindThread(t);
  if(t&&kind_(t)!=="repair")bindFiles(t);
  const nf=$("#t_newfiles"); if(nf) nf.addEventListener("change",()=>{const n=nf.files.length;$("#t_newfiles_l").textContent=n?[...nf.files].map(f=>f.name).join(", "):"ще се качат след създаването · до 10 MB всеки"});
  const tk=$("#btnTake"); if(tk) tk.onclick=()=>transfer(t,"u:"+me.id,"");
  const tb=$("#btnTrf"); if(tb) tb.onclick=()=>{$("#trf").hidden=false;$("#trf_to").focus()};
  const tn=$("#trfNo"); if(tn) tn.onclick=()=>{$("#trf").hidden=true};
  const tg=$("#trfGo"); if(tg) tg.onclick=()=>{const v=$("#trf_to").value;if(v==="__"){toast("Изберете към кого да прехвърлите.");return}transfer(t,v,"")};
  const del=$("#delT"); if(del) del.onclick=()=>{
    if(del.dataset.sure){deleteTicket(t)} else {del.dataset.sure="1";del.textContent="Потвърди изтриване";setTimeout(()=>{if(del.isConnected){del.textContent="Изтрий";delete del.dataset.sure}},4000)}
  };
}
$("#btnNew").onclick=()=>ui.view==="calendar"?openAbsence():openNew();

async function saveTicket(t){
  const kind=$("#tf").dataset.kind;
  const body={id:t?t.id:"",department:$("#t_dept").value,priority:Number($("#t_prio").value),status:$("#t_status").value};
  if(kind==="repair"){
    const invD=dval("#r_invdate","Дата по фактура");if(invD===null)return;
    const sentNew=!$("#r_op").hidden&&$("#t_status").value==="s3400";
    const sentD=sentNew?dval("#r_sentdate","Дата на изпращане"):($("#r_sentedit")?dval("#r_sentedit","Дата на изпращане"):"");if(sentD===null)return;
    Object.assign(body,{company:$("#r_comp").value,clientName:$("#r_comp").value?"":$("#r_cname").value.trim(),product:$("#r_product").value.trim(),
      serial:$("#r_serial").value.trim(),invoiceDate:invD,description:$("#r_fault").value.trim(),replaced:($("input[name=t_repl]:checked")||{}).value||"",
      statusDoc:$("#r_op").hidden?"":$("#r_sdoc").value.trim(),
      sentDate:sentD,newSerial:$("#r_op").hidden?"":$("#r_newserial").value.trim()});
    if(!body.company&&!body.clientName){toast("Изберете компания или напишете името на клиента.");return}
    if(!body.product||!body.serial){toast("Попълнете продукт и сериен номер.");return}
    if(!body.description){toast("Опишете повредата.");return}
    if(!body.replaced){toast("Изберете дали е за замяна: Да или Не.");return}
    if(body.status==="s3301"&&!$("#r_op").hidden&&!body.statusDoc){toast("Напишете номера на документа за операция 3301.");$("#r_sdoc").focus();return}
  }else{
    Object.assign(body,{title:$("#t_title").value.trim(),description:$("#t_desc").value.trim(),company:$("#t_comp").value,site:$("#t_site").value.trim(),category:$("#t_cat").value});
    if(!body.title||!body.description){toast("Попълнете заглавие и описание на проблема.");return}
  }
  if(!t){body.assignee=$("#t_asg").value.replace(/^u:/,"")}
  const btn=$("#saveT");btn.disabled=true;
  const queued=!t&&kind!=="repair"&&$("#t_newfiles")?[...$("#t_newfiles").files]:[];
  try{const r=await api("tickets/save",body);
    if(queued.length&&r.id){btn.textContent="Качване на файловете…";await uploadFiles(r.id,queued)}
    await refresh();
    if(!t&&!r.unchanged){openTicket(r.id);setTimeout(()=>{const n=$("#t_note");if(n){n.scrollIntoView({block:"center"});n.focus()}},50)}else closeDrawer();
    toast(r.unchanged?"Няма промени за запазване.":(t?`Запазен ${tno(t.no)}`:`Създаден ${tno(r.id)}`+(body.assignee&&body.assignee!==me.id?` и насочен към ${uname(body.assignee)}`:"")))}
  catch(e){btn.disabled=false;toast(e.message)}
}
async function transfer(t,to,reason){
  try{await api("tickets/transfer",{id:t.id,to,reason});await refresh();openTicket(t.id);
    const id=to.slice(2);toast(to==="u:"+me.id?"Поехте тикета.":to.startsWith("u:")?`Прехвърлен на ${uname(id)}.`:to.startsWith("d:")?`Насочен към отдел ${dname(id)}.`:"Тикетът е свободен в отдела.")}
  catch(e){toast(e.message)}
}
const kind_=t=>t.kind||"ticket";
/* ---------- files ---------- */
const FILE_MAX=10*1024*1024;
const fileUrl=id=>(window.__fileUrl||(i=>"/api/files/"+i))(id);
const fsize=n=>n<1024?n+" B":n<1048576?(n/1024).toFixed(0)+" KB":(n/1048576).toFixed(1)+" MB";
const isImg=f=>/^image\/(png|jpeg|gif|webp)$/.test(f.type);
const fext=n=>((n.match(/\.([a-z0-9]{1,5})$/i)||[])[1]||"файл").toUpperCase();
function filesInner(t){
  const fs=t.files||[];
  return `<div class="nhead">Файлове${fs.length?` (${fs.length})`:""}</div>
    ${fs.length?`<div class="flist">${fs.map(f=>`<div class="fitem">
      <a class="fthumb" href="${fileUrl(f.id)}" target="_blank" rel="noopener">${isImg(f)?`<img src="${fileUrl(f.id)}" alt="" loading="lazy">`:`<span>${esc(fext(f.name))}</span>`}</a>
      <div class="finfo"><a href="${fileUrl(f.id)}" target="_blank" rel="noopener" class="fname">${esc(f.name)}</a>
        <span class="note">${fsize(f.size)} · ${f.by===me.id?"Аз":esc(uname(f.by))} · ${fmt(f.at)}</span></div>
      ${(f.by===me.id||me.isAdmin)?`<button type="button" class="fdel" data-fdel="${esc(f.id)}" aria-label="Изтрий ${esc(f.name)}">✕</button>`:""}
    </div>`).join("")}</div>`:""}
    <label class="fdrop" id="fdrop"><input type="file" id="f_input" multiple hidden>
      <b>+ Прикачи файлове</b><span class="note">или ги пуснете тук · до 10 MB всеки (снимки, PDF, документи)</span></label>`;
}
const filesHtml=t=>`<div class="files" id="files">${filesInner(t)}</div>`;
async function uploadFiles(ticketId,list){
  let ok=0;
  for(const f of list){
    if(f.size>FILE_MAX){toast(`„${f.name}“ е по-голям от 10 MB.`);continue}
    try{
      const r=await fetch(`/api/files/upload?ticket=${encodeURIComponent(ticketId)}&name=${encodeURIComponent(f.name)}`,{method:"POST",credentials:"same-origin",headers:{"X-Tiketi":"1","Content-Type":f.type||"application/octet-stream"},body:f});
      const j=await r.json().catch(()=>({}));
      if(!r.ok||j.error)throw new Error(j.error||"Качването не успя.");
      ok++;
    }catch(e){toast(`„${f.name}“: ${e.message}`)}
  }
  return ok;
}
function bindFiles(t){
  const box=$("#files"); if(!box)return;
  const send=async list=>{
    if(!list.length)return;
    box.classList.add("busy");toast("Качване…");
    const n=await uploadFiles(t.id,[...list]);await refresh();
    const fresh=tickets.find(x=>x.id===t.id)||t;box.classList.remove("busy");
    box.innerHTML=filesInner(fresh);bindFiles(fresh);
    const h=$("#hist"); if(h) h.outerHTML=changesHtml(fresh);
    if(n)toast(n===1?"Файлът е прикачен.":`Прикачени са ${n} файла.`);
  };
  $("#f_input").addEventListener("change",e=>send(e.target.files));
  const dz=$("#fdrop");
  ["dragenter","dragover"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add("over")}));
  ["dragleave","drop"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove("over")}));
  dz.addEventListener("drop",e=>send(e.dataTransfer.files));
  box.addEventListener("click",async e=>{
    const d=e.target.closest("[data-fdel]");if(!d)return;
    if(!d.dataset.sure){d.dataset.sure="1";d.textContent="Изтрий?";d.classList.add("sure");return}
    try{await api("files/delete",{id:d.dataset.fdel});await refresh();const fresh=tickets.find(x=>x.id===t.id)||t;box.innerHTML=filesInner(fresh);bindFiles(fresh);
      const h=$("#hist"); if(h) h.outerHTML=changesHtml(fresh);toast("Файлът е изтрит.")}catch(err){toast(err.message)}
  });
}
function bindThread(t){
  const an=$("#addNote"); if(!an)return;
  an.onclick=()=>addNote(t);
  $("#t_note").addEventListener("keydown",e=>{if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)){e.preventDefault();addNote(t)}});
}
async function addNote(t){
  const ta=$("#t_note"),text=ta.value.trim(); if(!text){toast("Напишете бележката първо.");ta.focus();return}
  const btn=$("#addNote");btn.disabled=true;
  try{
    await api("tickets/note",{id:t.id,text});await refresh();
    const fresh=tickets.find(x=>x.id===t.id)||t;
    // Обновяваме само бележките и историята – недовършени промени по другите полета остават
    $("#thread").innerHTML=threadInner(fresh);bindThread(fresh);
    const h=$("#hist"); if(h) h.outerHTML=changesHtml(fresh);
    $("#t_note").focus();toast("Бележката е добавена");
  }catch(e){btn.disabled=false;toast(e.message)}
}
async function deleteTicket(t){
  try{await api("tickets/delete",{id:t.id});closeDrawer();await refresh();toast(`Изтрит ${tno(t.no)}`)}catch(e){toast(e.message)}
}

/* ---------- history ---------- */
const EVC={import:"--accent",file:"--accent",filedel:"--muted",create:"--accent",status:"--work",assign:"--wait",transfer:"--wait",take:"--wait",unassign:"--wait",prio:"--crit",edit:"--new",note:"--done"};
function evHtml(ev,withTicket){
  const ty=ev.type;
  const who=`${av(ev.by)}<b>${ev.by===me.id?"Аз":esc(uname(ev.by))}</b>`;
  const tk=withTicket?`<button type="button" class="tk" data-open="${esc(withTicket.id)}">${tno(withTicket.no)}</button>`:"";
  const person=id=>id?`<span class="who">${av(id)}${esc(uname(id))}</span>`:(ev.toDept?"отдел "+esc(ev.toDept):"свободен в отдела");
  const dmove=ev.toDept?`<div class="chg"><span class="note">Отдел:</span><span class="old">${esc(ev.fromDept)||"—"}</span> → <span>${esc(ev.toDept)}</span></div>`:"";
  const reason=ev.reason?`<div class="reason">„${esc(ev.reason)}“</div>`:"";
  let act="",body="";
  switch(ty){
    case"create":act="създаде тикета";body=ev.status?`<div class="chg">${pill(ev.status)}</div>${ev.doc?`<div class="reason">Документ № <span class="mono">${esc(ev.doc)}</span></div>`:""}`:"";break;
    case"take":act="пое тикета";body=(ev.from?`<div class="chg"><span class="old">${esc(uname(ev.from))}</span> → ${person(ev.to)}</div>`:"")+dmove;break;
    case"transfer":case"assign":act=ev.from?"прехвърли тикета":"насочи тикета";body=`<div class="chg">${ev.from?`<span class="who old">${esc(uname(ev.from))}</span> → `:""}${person(ev.to)}</div>${dmove}${reason}`;break;
    case"unassign":act=ev.toDept?"насочи тикета към отдел":"освободи тикета";body=`${ev.from?`<div class="chg"><span class="old">${esc(uname(ev.from))}</span> → ${ev.toDept?"отдел "+esc(ev.toDept):"свободен в отдела"}</div>`:""}${dmove}${reason}`;break;
    case"status":act="смени статуса";body=`<div class="chg">${pill(ev.from)} → ${pill(ev.to)}</div>${ev.doc?`<div class="reason">Документ № <span class="mono">${esc(ev.doc)}</span>${ev.sn?` · нов SN <span class="mono">${esc(ev.sn)}</span>`:""}</div>`:""}${ev.sent?`<div class="reason">Изпратено на ${bgd(ev.sent)}</div>`:""}${reason}`;break;
    case"prio":act="смени приоритета";body=`<div class="chg">${prio(ev.from)} → ${prio(ev.to)}</div>`;break;
    case"edit":act="редактира "+(ev.fields||[]).map(f=>f.l.toLowerCase()).join(", ");
      body=(ev.fields||[]).map(f=>f.f==="description"
        ?`<details><summary>Виж предишното описание</summary><div>${esc(f.from)||"(празно)"}</div></details>`
        :`<div class="chg"><span class="note">${esc(f.l)}:</span><span class="old">${esc(f.from)||"—"}</span> → <span>${esc(f.to)||"—"}</span></div>`).join("");break;
    case"file":act="прикачи файл";body=`<div class="t">${ev.fid&&withTicket===undefined&&(tickets.find(x=>x.log&&x.log.includes(ev))||{files:[]}).files.some(f=>f.id===ev.fid)?`<a href="${fileUrl(ev.fid)}" target="_blank" rel="noopener">${esc(ev.name)}</a>`:esc(ev.name)} <span class="note">${fsize(ev.size||0)}</span></div>`;break;
    case"filedel":act="изтри файл";body=`<div class="t old">${esc(ev.name)}</div>`;break;
    case"import":act="импортира от стара таблица";body=`<div class="chg">${pill(ev.status)}</div>${ev.doc?`<div class="reason">Документ № <span class="mono">${esc(ev.doc)}</span></div>`:""}${ev.file?`<div class="note">${esc(ev.file)}${ev.line?`, ред ${ev.line}`:""}</div>`:""}`;break;
    case"note":act="добави бележка";body=`<div class="bub">${esc(ev.text)}</div>`;break;
    default:body=`<div class="t">${esc(ev.text||"")}</div>`;
  }
  return `<div class="ev" data-t="${ty==="note"?"note":"chg"}" style="--mk:var(${EVC[ty]||"--muted"})"><span class="m">${tk}${who}<span>${act}</span><span>· ${fmt(ev.at)}</span></span>${body}</div>`;
}
$("#btnHist").onclick=()=>{
  ui.openId=null;
  const all=[];tickets.forEach(t=>(t.log||[]).forEach(ev=>all.push({ev,t})));
  all.sort((a,b)=>String(b.ev.at).localeCompare(String(a.ev.at)));
  showDrawer(`<div class="dh"><h2>История на всички тикети</h2><button type="button" data-x aria-label="Затвори">✕</button></div>
  <div class="db"><div class="hist" id="hist" data-f="all">
    <div class="hhead"><span class="note">Последни ${Math.min(all.length,200)} от ${all.length} действия</span>${TABS}</div>
    <div class="tl">${all.slice(0,200).map(x=>evHtml(x.ev,x.t)).join("")||`<div class="note">Още няма действия.</div>`}</div>
  </div></div>
  <div class="df"><div class="r"><button type="button" data-x>Затвори</button></div></div>`);
  const h=$("#hist"); tabsBind(h);
  h.addEventListener("click",e=>{const o=e.target.closest("[data-open]");if(o)openTicket(o.dataset.open)});
};

/* ---------- companies ---------- */
const CF=[["name","Име на компанията",160,true],["eik","ЕИК",20],["vat","ДДС номер",20],["contact_person","Лице за контакт",120],["phone","Телефон",60],["email","Имейл",120],["city","Град",80],["address","Адрес",250],["contract","Договор / абонамент",200]];
function companyForm(c){
  const isNew=!c; c=c||{};
  const ts=isNew?[]:tickets.filter(t=>t.company===c.id).sort((a,b)=>(CLOSED.has(a.status)-CLOSED.has(b.status))||(b.no-a.no));
  const inp=([k,l,max,req])=>`<label class="f">${req?`<span>${l} <span class="req">*</span></span>`:l}<input id="c_${k}" maxlength="${max}" value="${esc(c[k]||"")}" ${k==="email"?'type="email"':""} ${k==="phone"?'type="tel"':""}></label>`;
  return `<div class="dh"><h2>${isNew?"Нова компания":esc(c.name)}</h2><button type="button" data-x aria-label="Затвори">✕</button></div>
  <form class="db" id="cf">
    ${inp(CF[0])}
    <div class="g2">${CF.slice(1,3).map(inp).join("")}</div>
    <div class="g3">${CF.slice(3,6).map(inp).join("")}</div>
    <div class="g2">${CF.slice(6,8).map(inp).join("")}</div>
    ${inp(CF[8])}
    <label class="f">Обекти (по един на ред)<textarea id="c_sites" maxlength="4000" placeholder="Напр.&#10;Склад Плевен, ул. Дойран 10&#10;Офис София, бул. България 51">${esc(c.sites||"")}</textarea></label>
    <label class="f">Бележки<textarea id="c_notes" maxlength="5000" placeholder="Кодове за достъп до обекта не пишете тук. Работно време, особености, кой да се търси…">${esc(c.notes||"")}</textarea></label>
    ${isNew?"":`<div class="sect"><div class="hhead"><h3>Тикети на компанията (${ts.length})</h3><button type="button" class="primary" id="cNewT">+ Нов тикет за компанията</button></div>
      ${ts.length?`<div class="ctl">${ts.map(t=>`<button type="button" data-open="${esc(t.id)}"><span class="no">${tno(t.no)}</span><span class="ttl">${esc(t.title)}</span>${pill(t.status)}</button>`).join("")}</div>`:`<div class="note">Още няма тикети за тази компания.</div>`}</div>`}
  </form>
  <div class="df">${(!isNew&&me.isAdmin)?`<button type="button" class="danger" id="delC">Изтрий</button>`:""}<div class="r"><button type="button" data-x>Отказ</button><button type="button" class="primary" id="saveC">${isNew?"Създай компанията":"Запази"}</button></div></div>`;
}
function openCompany(id){
  const c=id?comp(id):null; if(id&&!c)return;
  ui.openId=null; showDrawer(companyForm(c));
  $("#cf").addEventListener("submit",e=>e.preventDefault());
  $("#saveC").onclick=async()=>{
    const body={id:c?c.id:""};CF.forEach(([k])=>body[k]=$("#c_"+k).value.trim());body.sites=$("#c_sites").value;body.notes=$("#c_notes").value;
    if(!body.name){toast("Въведете името на компанията.");return}
    $("#saveC").disabled=true;
    try{const r=await api("companies/save",body);await refresh();openCompany(r.id);toast(c?"Компанията е запазена.":"Компанията е създадена.")}
    catch(e){$("#saveC").disabled=false;toast(e.message)}
  };
  const nt=$("#cNewT"); if(nt) nt.onclick=()=>{const s=sitesOf(c.id);openNew({company:c.id,site:s.length===1?s[0]:""})};
  const ctl=$("#drawer .ctl"); if(ctl) ctl.addEventListener("click",e=>{const b=e.target.closest("[data-open]");if(b)openTicket(b.dataset.open)});
  const del=$("#delC"); if(del) del.onclick=async()=>{
    if(!del.dataset.sure){del.dataset.sure="1";del.textContent="Потвърди изтриване";return}
    try{await api("companies/delete",{id:c.id});closeDrawer();await refresh();toast("Компанията е изтрита.")}catch(e){toast(e.message)}
  };
}
$("#btnNewComp").onclick=()=>openCompany(null);

/* ---------- my profile ---------- */
$("#meBox").onclick=()=>{
  ui.openId=null;
  showDrawer(`<div class="dh"><h2>${esc(me.name)}</h2><button type="button" data-x aria-label="Затвори">✕</button></div>
  <div class="db">
    <div class="meta">Потребител: <b>${esc(me.username)}</b>${me.isAdmin?" · администратор":""}</div>
    <form class="sect" id="pf" ${emailOn?"":"hidden"}><h3>Имейл известия</h3>
      <label class="f">Моят имейл<input id="p_email" type="email" maxlength="160" value="${esc((user(me.id)||{}).email||"")}" placeholder="ime@firma.bg" autocomplete="email"></label>
      <label class="chk"><input type="checkbox" id="p_notify" ${(user(me.id)||{}).notify!==false?"checked":""}> Пращай ми имейл, когато ми възложат или прехвърлят тикет</label>
      ${emailOn?"":`<div class="note">Имейлите още не са включени от администратора. Запишете имейла си – ще започнете да ги получавате, когато ги включи.</div>`}
      <div><button type="submit" class="primary">Запази</button></div>
    </form>
    <form class="sect" id="pwf"><h3>Смяна на парола</h3>
      <label class="f">Текуща парола<input id="pw_old" type="password" autocomplete="current-password"></label>
      <label class="f">Нова парола (поне 8 знака)<input id="pw_new" type="password" autocomplete="new-password"></label>
      <label class="f">Повторете новата парола<input id="pw_new2" type="password" autocomplete="new-password"></label>
      <div><button type="submit" class="primary">Смени паролата</button></div>
    </form>
  </div>
  <div class="df"><button type="button" class="danger" id="logoutBtn">Изход</button><div class="r"><button type="button" data-x>Затвори</button></div></div>`);
  $("#logoutBtn").onclick=async()=>{cacheClear();try{await api("logout",{})}catch(e){}location.href="/login?out=1"};
  $("#pf").addEventListener("submit",async e=>{e.preventDefault();
    try{await api("me/profile",{email:$("#p_email").value.trim(),notify:$("#p_notify").checked});await refresh();toast("Запазено.")}catch(err){toast(err.message)}});
  $("#pwf").addEventListener("submit",async e=>{e.preventDefault();
    const o=$("#pw_old").value,n=$("#pw_new").value;
    if(n!==$("#pw_new2").value){toast("Двете нови пароли не съвпадат.");return}
    try{await api("me/password",{old:o,new:n});closeDrawer();toast("Паролата е сменена. Другите ви устройства ще трябва да влязат отново.")}catch(err){toast(err.message)}});
};

/* ---------- team (admin manages users) ---------- */
function userForm(u){
  const isNew=!u; u=u||{id:"",username:"",name:"",role:"user",active:true,department:""};
  return `<form class="sect" id="uf"><h3>${isNew?"Нов потребител":"Редакция: "+esc(u.name)}</h3>
    <div class="g2">
      <label class="f">Име и фамилия<input id="u_name" maxlength="100" value="${esc(u.name)}"></label>
      <label class="f">Потребителско име<input id="u_user" maxlength="50" value="${esc(u.username)}" autocapitalize="none" placeholder="напр. ivan.p"></label>
      <label class="f">${isNew?"Парола (поне 8 знака)":"Нова парола (празно = без промяна)"}<input id="u_pass" type="text" autocomplete="off"></label>
      <label class="f" ${emailOn?"":"hidden"}>Имейл (за известия)<input id="u_email" type="email" maxlength="160" value="${esc(u.email||"")}" placeholder="ime@firma.bg"></label>
      <label class="f">Отдел<select id="u_dept"><option value="">— без отдел —</option>${departments.map(d=>`<option value="${esc(d.id)}" ${d.id===u.department?"selected":""}>${esc(d.name)}</option>`).join("")}</select></label>
      <label class="f">Роля<select id="u_role"><option value="user" ${u.role==="user"?"selected":""}>Потребител</option><option value="admin" ${u.role==="admin"?"selected":""}>Администратор</option></select></label>
    </div>
    <label class="chk"><input id="u_active" type="checkbox" ${u.active?"checked":""}> Активен (може да влиза)</label>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="submit" class="primary">${isNew?"Добави потребителя":"Запази"}</button><button type="button" id="ucancel">Отказ</button></div>
  </form>`;
}
function drawTeam(){
  const box=$("#teamList"); if(!box)return;
  const act=team().length;
  box.innerHTML=users.map(u=>`<div class="mrow">${av(u.id)}<span class="nm">${esc(u.name)}${u.id===me.id?" (вие)":""}<br><span class="note">${esc(u.username)}${me.isAdmin?(u.email?" · "+esc(u.email):" · без имейл"):""}${dname(u.department)?" · "+esc(dname(u.department)):""}</span> ${u.role==="admin"?`<span class="role">админ</span>`:""} ${u.active?"":`<span class="off">· неактивен</span>`}</span>
    ${me.isAdmin?`<button type="button" data-edit="${esc(u.id)}">Редактирай</button>`:""}</div>`).join("")
    +Array.from({length:Math.max(0,maxUsers-act)},()=>`<div class="mrow"><span class="av" style="background:var(--line)"></span><span class="nm slot">Свободно място</span>${me.isAdmin?`<button type="button" data-add="1">Добави</button>`:""}</div>`).join("");
}
$("#btnUsers").onclick=()=>{
  ui.openId=null;
  showDrawer(`<div class="dh"><h2>Екип (${team().length}/${maxUsers})</h2><button type="button" data-x aria-label="Затвори">✕</button></div>
  <div class="db"><div class="note">${me.isAdmin?"Като администратор добавяте колегите, задавате им парола и можете да деактивирате профил, за да освободите място.":"Потребителите се добавят от администратора."}</div>
  <div id="teamList"></div><div id="ufBox"></div>${me.isAdmin&&emailOn?`<div class="sect" id="emailBox"><h3>Имейл известия</h3><div class="note">Проверка…</div></div>`:""}</div>
  <div class="df"><div class="r"><button type="button" data-x>Затвори</button></div></div>`);
  drawTeam();
  if(me.isAdmin)loadEmailStatus();
  $("#teamList").addEventListener("click",e=>{
    const ed=e.target.closest("[data-edit]"), ad=e.target.closest("[data-add]");
    if(!ed&&!ad)return;
    const u=ed?user(ed.dataset.edit):null;
    $("#ufBox").innerHTML=userForm(u);
    $("#ucancel").onclick=()=>$("#ufBox").innerHTML="";
    $("#u_name").focus();
    $("#uf").addEventListener("submit",async ev=>{ev.preventDefault();
      const body={id:u?u.id:"",name:$("#u_name").value.trim(),username:$("#u_user").value.trim(),password:$("#u_pass").value,role:$("#u_role").value,active:$("#u_active").checked,email:$("#u_email").value.trim(),department:$("#u_dept").value};
      try{await api("users/save",body);await refresh();$("#ufBox").innerHTML="";drawTeam();$("#drawer h2").textContent=`Екип (${team().length}/${maxUsers})`;toast(u?"Потребителят е запазен.":"Потребителят е добавен.")}
      catch(err){toast(err.message)}});
  });
};

/* ---------- departments ---------- */
function deptForm(d){
  const isNew=!d; d=d||{id:"",name:"",categories:[]};
  return `<form class="sect" id="df"><h3>${isNew?"Нов отдел":"Редакция: "+esc(d.name)}</h3>
    <label class="f">Име на отдела<input id="d_name" maxlength="80" value="${esc(d.name)}" placeholder="Напр. Монтаж"></label>
    <label class="f">Бланка за нов тикет<select id="d_form"><option value="standard" ${d.form!=="repair"?"selected":""}>Обикновена – заглавие, описание, обект, категория</option><option value="repair" ${d.form==="repair"?"selected":""}>Сервизна (ремонт) – клиент, продукт, сериен №, повреда, заменено</option></select></label>
    <label class="f">Категории (по една на ред)<textarea id="d_cats" placeholder="Напр.&#10;Нов монтаж&#10;Разширение на система&#10;Демонтаж">${esc(d.categories.join("\n"))}</textarea></label>
    <div class="note">Служителите се добавят към отдел от „Екип“ → „Редактирай“.</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="submit" class="primary">${isNew?"Създай отдела":"Запази"}</button><button type="button" id="dcancel">Отказ</button>
      ${isNew?"":`<button type="button" class="danger" id="ddel">Изтрий отдела</button>`}</div>
  </form>`;
}
function drawDepts(){
  const box=$("#deptList"); if(!box)return;
  const open=tickets.filter(t=>!CLOSED.has(t.status));
  box.innerHTML=departments.map(d=>{const ms=membersOf(d.id);return `<div class="dcard">
    <div class="dtop"><div><b>${esc(d.name)}</b>${d.form==="repair"?` <span class="dtag rtag">сервизна бланка</span>`:""} <span class="note">· ${open.filter(t=>t.department===d.id).length} отворени · ${open.filter(t=>t.department===d.id&&!t.assignee).length} свободни</span></div>
      ${me.isAdmin?`<button type="button" data-dedit="${esc(d.id)}">Редактирай</button>`:""}</div>
    <div class="dmem">${ms.length?ms.map(u=>`<span class="who">${av(u.id)}${esc(u.name)}</span>`).join(""):`<span class="note">Няма служители в отдела</span>`}</div>
    <div class="dcats">${d.categories.length?d.categories.map(c=>`<span class="ctag">${esc(c)}</span>`).join(""):`<span class="note">Няма категории</span>`}</div>
  </div>`}).join("")||`<div class="note">Още няма отдели.</div>`;
}
$("#btnDepts").onclick=()=>{
  ui.openId=null;
  showDrawer(`<div class="dh"><h2>Отдели</h2><button type="button" data-x aria-label="Затвори">✕</button></div>
  <div class="db"><div class="note">Всеки отдел има свои категории. Тикетите се насочват към отдел или към конкретен човек.</div>
  ${me.isAdmin?`<div><button type="button" class="primary" id="dAdd">+ Нов отдел</button></div>`:""}
  <div id="dfBox"></div><div id="deptList" class="stack"></div></div>
  <div class="df"><div class="r"><button type="button" data-x>Затвори</button></div></div>`);
  drawDepts();
  const edit=d=>{
    $("#dfBox").innerHTML=deptForm(d);$("#d_name").focus();
    $("#dcancel").onclick=()=>$("#dfBox").innerHTML="";
    const del=$("#ddel"); if(del) del.onclick=async()=>{
      if(!del.dataset.sure){del.dataset.sure="1";del.textContent="Потвърди изтриване";return}
      try{await api("departments/delete",{id:d.id});await refresh();$("#dfBox").innerHTML="";drawDepts();toast("Отделът е изтрит.")}catch(e){toast(e.message)}};
    $("#df").addEventListener("submit",async ev=>{ev.preventDefault();
      const body={id:d?d.id:"",name:$("#d_name").value.trim(),form:$("#d_form").value,categories:$("#d_cats").value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean)};
      if(!body.name){toast("Въведете име на отдела.");return}
      try{await api("departments/save",body);await refresh();$("#dfBox").innerHTML="";drawDepts();toast(d?"Отделът е запазен.":"Отделът е създаден.")}catch(e){toast(e.message)}});
  };
  const a=$("#dAdd"); if(a) a.onclick=()=>edit(null);
  $("#deptList").addEventListener("click",e=>{const b=e.target.closest("[data-dedit]");if(b)edit(dept(b.dataset.dedit))});
};

async function loadEmailStatus(){
  const box=$("#emailBox");if(!box)return;
  try{
    const s=await api("email-status");
    box.innerHTML=`<h3>Имейл известия</h3>`+(s.configured
      ?`<div class="estat on">● Включени · ${esc(s.provider)} · от ${esc(s.from)}</div>
        <div class="note">Служителят получава имейл, когато друг му възложи или прехвърли тикет (ако има записан имейл).</div>
        ${s.lastError?`<div class="warn">Последна грешка: ${esc(s.lastError)}</div>`:""}
        <div><button type="button" id="emailTest">Изпрати пробен имейл до мен</button></div>`
      :`<div class="estat">○ Не са настроени</div><div class="note">Добавят се в Cloudflare с ключ от Brevo или Resend – стъпките са в README.md, раздел „Имейл известия“.</div>`);
    const b=$("#emailTest");if(b)b.onclick=async()=>{b.disabled=true;try{const r=await api("email-test",{});toast("Изпратен до "+r.to+". Проверете пощата (и папка Спам).")}catch(e){toast(e.message)}b.disabled=false};
  }catch(e){box.innerHTML=`<h3>Имейл известия</h3><div class="note">${esc(e.message)}</div>`}
}

/* ---------- import of old repairs (admin) ---------- */
const IMP_FIELDS=[
  {k:"client",l:"Клиент",hint:/клиент|client|фирма|компания|customer|име/i},
  {k:"product",l:"Продукт",req:true,hint:/продукт|модел|артикул|устройство|у-во|product|model|item/i},
  {k:"serial",l:"Сериен №",hint:/сериен|serial|s\/?n|сер\.? ?№|imei/i},
  {k:"fault",l:"Повреда",hint:/повреда|дефект|проблем|описание|fault|defect|problem/i},
  {k:"replaced",l:"За замяна (Да/Не)",hint:/замян|замен|replace|подмян/i},
  {k:"status",l:"Статус / операция",hint:/статус|status|състояние|операция|етап/i},
  {k:"date",l:"Дата на приемане",hint:/дата|date|приет|получен/i},
  {k:"doc",l:"Документ №",hint:/документ|док|doc|протокол|№ ?док/i},
  {k:"newSerial",l:"Сериен № на новото у-во",hint:/нов.*сер|new.*serial|заместващ/i},
  {k:"invoiceDate",l:"Дата по фактура",hint:/фактур|invoice/i},
  {k:"note",l:"Бележка",hint:/бележк|коментар|note|comment|забележк/i},
  {k:"sentDate",l:"Дата изпращане към Риека",hint:/dhl|изпращ|изпрат|sent/i},
  {k:"backDate",l:"Дата получено от Риека",hint:/получено|върнат|received|returned/i},
];
// Колони „1300 / 3400 / …“ с 1 за извършена операция
const OP_CODES=["s1300","s3301","s3400","s1400","s3300","s1401"];
const DONE_RX=/^(1|x|✓|✔|да|yes|y|true|д)$/i;
const YES_RX=/^(да|yes|y|1|x|✓|true|д|заменено|замяна)$/i;
function guessStatus(v){
  const x=String(v||"").toLowerCase();
  const m=x.match(/\b(1300|3400|1400|3300|1401|3301)\b/);if(m)return "s"+m[1];
  if(/регистр/.test(x))return "s0";
  if(/нов|заместв|подмен|замен/.test(x)&&/клиент|изпис|дад/.test(x))return "s3301";
  if(/гл\.? ?склад|главен склад/.test(x))return "s1401";
  if(/риека|изпрат|пратен/.test(x)&&!/върн|получ/.test(x))return "s3400";
  if(/върн|отремонт|получ.*риека/.test(x))return "s1400";
  if(/клиент|предаден|получил|готов|приключ|изпълн/.test(x))return "s3300";
  return "s1300";
}
function parseDate(v){
  if(v instanceof Date&&!isNaN(v))return new Date(Date.UTC(v.getFullYear(),v.getMonth(),v.getDate(),9)).toISOString();
  const s=String(v||"").trim();if(!s)return "";
  let m=s.match(/^(\d{1,2})([.\/-])(\d{1,2})[.\/-](\d{2,4})/);
  if(m){
    const y=+m[4]<100?2000+ +m[4]:+m[4];let a=+m[1],b=+m[3],day,mon;
    // 25.12.2024 е ден.месец; 12/25/2024 (американски Excel) е месец/ден; при съмнение: „.“ → ден.месец, „/“ → месец/ден
    if(a>12){day=a;mon=b}else if(b>12){day=b;mon=a}else if(m[2]==="/"){mon=a;day=b}else{day=a;mon=b}
    if(mon<1||mon>12||day<1||day>31)return "";
    const d=new Date(Date.UTC(y,mon-1,day,9));return isNaN(d)?"":d.toISOString()}
  m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);if(m){const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3],9));return isNaN(d)?"":d.toISOString()}
  if(/^\d{5}(\.\d+)?$/.test(s)){const d=new Date(Date.UTC(1899,11,30)+parseFloat(s)*864e5);return d.toISOString()}
  return "";
}
function loadXLSX(){
  if(window.XLSX)return Promise.resolve();
  return new Promise((ok,no)=>{const sc=document.createElement("script");sc.src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";sc.onload=ok;sc.onerror=()=>no(new Error("Не можах да заредя четеца за Excel. Проверете интернет връзката или запишете таблицата като CSV."));document.head.appendChild(sc)});
}
const imp={file:"",sheets:{},sheet:"",rows:[],head:[],map:{},ops:{},smap:{},dept:"",defStatus:"s1300"};
$("#btnImport").onclick=()=>{
  ui.openId=null;Object.assign(imp,{file:"",sheets:{},sheet:"",rows:[],head:[],map:{},ops:{},smap:{},dept:(repairDepts()[0]||{}).id||""});
  showDrawer(`<div class="dh"><h2>Импорт на стари ремонти</h2><button type="button" data-x aria-label="Затвори">✕</button></div>
  <div class="db" id="impBody">
    <div class="note">Изберете Excel (.xlsx, .xls) или CSV файл. Първият ред трябва да е със заглавията на колоните. Нищо не се записва, докато не потвърдите на последната стъпка.</div>
    <label class="fdrop"><input type="file" id="impFile" accept=".xlsx,.xls,.csv" hidden><b>Избери файл</b><span class="note">или го пуснете тук</span></label>
    <div id="impStep"></div>
  </div>
  <div class="df"><div class="r"><button type="button" data-x>Затвори</button><button type="button" class="primary" id="impGo" hidden>Импортирай</button></div></div>`);
  const pick=async f=>{
    if(!f)return;
    try{
      imp.file=f.name;$("#impStep").innerHTML=`<div class="note">Чета ${esc(f.name)}…</div>`;
      await loadXLSX();
      // CSV се чете като текст – иначе Excel-четецът тълкува „11.12.2024“ като 12 ноември
      const wb=XLSX.read(await f.arrayBuffer(),{type:"array",cellDates:true,raw:/\.csv$/i.test(f.name)});
      imp.sheets={};for(const n of wb.SheetNames)imp.sheets[n]=XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1,defval:"",raw:true});
      imp.sheet=wb.SheetNames.find(n=>imp.sheets[n].length>1)||wb.SheetNames[0];
      useSheet();
    }catch(e){$("#impStep").innerHTML=`<div class="warn">${esc(e.message||e)}</div>`}
  };
  $("#impFile").addEventListener("change",e=>pick(e.target.files[0]));
  const dz=$("#impBody .fdrop");
  ["dragenter","dragover"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add("over")}));
  ["dragleave","drop"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove("over")}));
  dz.addEventListener("drop",e=>pick(e.dataTransfer.files[0]));
  $("#impGo").onclick=runImport;
};
function useSheet(){
  const all=imp.sheets[imp.sheet]||[];
  const hi=all.findIndex(r=>r.filter(c=>String(c).trim()).length>=2);
  imp.head=(all[hi]||[]).map((h,i)=>String(h).trim()||`Колона ${i+1}`);
  imp.rows=all.slice(hi+1).map((r,i)=>({r,line:hi+i+2})).filter(x=>x.r.some(c=>String(c).trim()));
  imp.rowsAll=imp.rows;
  imp.map={};imp.ops={};const used=new Set();
  for(const k of OP_CODES){const code=k.slice(1),i=imp.head.findIndex((h,j)=>!used.has(j)&&new RegExp("(^|\\D)"+code+"(\\D|$)").test(h));if(i>=0){imp.ops[k]=i;used.add(i)}}
  for(const f of IMP_FIELDS){const i=imp.head.findIndex((h,j)=>!used.has(j)&&f.hint.test(h));if(i>=0){imp.map[f.k]=i;used.add(i)}}
  if(Object.keys(imp.ops).length)delete imp.map.status;
  drawImport();
}
const cell=(x,k)=>imp.map[k]===undefined?"":x.r[imp.map[k]];
const opsMode=()=>Object.keys(imp.ops).length>0;
// В старата таблица една колона е „Дата на фактура / Решение“: дата → дата по фактура, текст → бележка
function invAndNote(x){
  const raw=imp.map.invoiceDate===undefined?"":cell(x,"invoiceDate"),d=parseDate(raw);
  const extra=!d&&String(raw).trim()?String(raw).trim():"";
  return {invoiceDate:d?d.slice(0,10):"",note:[String(cell(x,"note")).trim(),extra].filter(Boolean).join("\n")};
}
function mapped(x){
  if(opsMode()){
    const done=OP_CODES.filter(k=>imp.ops[k]!==undefined&&DONE_RX.test(String(x.r[imp.ops[k]]).trim()));
    let repl=YES_RX.test(String(cell(x,"replaced")).trim());
    if(done.includes("s3301")||done.includes("s1401"))repl=true;else if(done.includes("s1400")||done.includes("s3300"))repl=false;
    const path=REPAIR_PATH[repl?"yes":"no"];let st="s0";for(const k of path)if(done.includes(k))st=k;
    const d0=parseDate(cell(x,"date")),ds=parseDate(cell(x,"sentDate"))||d0,db=parseDate(cell(x,"backDate"))||ds;
    const when={s1300:d0,s3301:d0,s3400:ds,s1400:db,s3300:db,s1401:db};
    return {line:x.line,client:String(cell(x,"client")).trim(),product:String(cell(x,"product")).trim(),serial:String(cell(x,"serial")).trim(),
      fault:String(cell(x,"fault")).trim(),replaced:repl?"yes":"no",status:st,ops:done.map(k=>({k,at:when[k]||""})),
      date:d0,doc:String(cell(x,"doc")).trim(),newSerial:String(cell(x,"newSerial")).trim(),...invAndNote(x)};
  }
  const st=imp.map.status!==undefined?(imp.smap[String(cell(x,"status")).trim()]||guessStatus(cell(x,"status"))):imp.defStatus;
  return {line:x.line,client:String(cell(x,"client")).trim(),product:String(cell(x,"product")).trim(),serial:String(cell(x,"serial")).trim(),
    fault:String(cell(x,"fault")).trim(),replaced:YES_RX.test(String(cell(x,"replaced")).trim())?"yes":"no",status:st,
    date:parseDate(cell(x,"date")),doc:String(cell(x,"doc")).trim(),newSerial:String(cell(x,"newSerial")).trim(),...invAndNote(x)};
}
function drawImport(){
  const colOpts=k=>`<option value="">— няма —</option>`+imp.head.map((h,i)=>`<option value="${i}" ${imp.map[k]===i?"selected":""}>${esc(h)}</option>`).join("");
  const statusVals=imp.map.status===undefined?[]:[...new Set(imp.rows.map(x=>String(cell(x,"status")).trim()).filter(Boolean))].slice(0,40);
  const stOpts=sel=>REPAIR_STATUSES.map(s=>`<option value="${s.k}" ${s.k===sel?"selected":""}>${s.code?s.code+" · ":""}${esc(s.l)}</option>`).join("");
  const list=imp.rows.map(mapped).filter(r=>r.product||r.serial||r.client),bad=list.filter(r=>!r.product),empty=imp.rows.length-list.length;
  $("#impStep").innerHTML=`
    <div class="sect"><h3>1. Файл</h3>
      <div class="meta"><b>${esc(imp.file)}</b> · ${list.length} реда с ремонти${empty?` · ${empty} празни реда (без клиент, продукт и SN) се прескачат`:""}</div>
      ${/\?{3,}/.test(imp.head.join(" ")+list.slice(0,50).map(r=>r.client+r.note).join(" "))?`<div class="warn">Във файла има много въпросителни „???“ вместо кирилица – файлът е записан като CSV без UTF-8 и кирилицата е загубена. Запишете го пак от Excel като <b>CSV UTF-8</b> или качете направо .xlsx.</div>`:""}
      ${Object.keys(imp.sheets).length>1?`<label class="f">Лист<select id="impSheet">${Object.keys(imp.sheets).map(n=>`<option ${n===imp.sheet?"selected":""}>${esc(n)}</option>`).join("")}</select></label>`:""}
      <label class="f">Отдел за ремонтите<select id="impDept">${repairDepts().map(d=>`<option value="${esc(d.id)}" ${d.id===imp.dept?"selected":""}>${esc(d.name)}</option>`).join("")||`<option value="">— няма отдел със сервизна бланка —</option>`}</select></label>
    </div>
    <div class="sect"><h3>2. Коя колона какво е</h3>
      <div class="note">Познах колоните по заглавията им – проверете и поправете при нужда.</div>
      <div class="g2">${IMP_FIELDS.map(f=>`<label class="f">${f.req?`<span>${f.l} <span class="req">*</span></span>`:f.l}<select data-map="${f.k}">${colOpts(f.k)}</select></label>`).join("")}</div>
    </div>
    <div class="sect"><h3>3. Статуси</h3>
      ${opsMode()?`<div class="note">Открих колони с операциите – статусът на всеки ремонт е последната отбелязана операция (1, x или „да“ в клетката). Историята се попълва с датите от таблицата.</div>
        <div class="g2">${OP_CODES.map(k=>`<label class="f">${st(k).code} · ${esc(st(k).l)}<select data-op="${k}"><option value="">— няма —</option>${imp.head.map((h,i)=>`<option value="${i}" ${imp.ops[k]===i?"selected":""}>${esc(h.replace(/\s+/g," "))}</option>`).join("")}</select></label>`).join("")}</div>`
      :imp.map.status===undefined?`<label class="f">Няма колона със статус – всички стават<select id="impDef">${stOpts(imp.defStatus)}</select></label>`
        :statusVals.length?`<div class="note">Как да се преведе всяка стойност от старата таблица:</div><div class="smap">${statusVals.map(v=>`<div class="smrow"><span>${esc(v)}</span><select data-sv="${esc(v)}">${stOpts(imp.smap[v]||guessStatus(v))}</select></div>`).join("")}</div>
          <div class="note">Празен статус → 1300. Ако статусът е 3301/1401, ремонтът се води „за замяна“; ако е 1400/3300 – „без замяна“.</div>`:`<div class="note">Колоната със статус е празна – всички стават 1300.</div>`}
    </div>
    <div class="sect"><h3>4. Преглед</h3>
      <div class="meta">${list.length-bad.length} за импорт${bad.length?` · <span class="unas">${bad.length} без продукт – ще се пропуснат</span>`:""} · вече въведени (същия SN и дата) се пропускат автоматично</div>
      <div class="chips">${REPAIR_STATUSES.map(s=>{const n=list.filter(r=>r.product&&r.status===s.k).length;return n?`<span class="bal zero">${s.code||s.l}: ${n}</span>`:""}).join("")}</div>
      <div class="tablebox"><table class="imptab"><thead><tr><th>Ред</th><th>Клиент</th><th>Продукт</th><th>SN</th><th>Замяна</th><th>Статус</th><th>Дата</th><th>Фактура</th><th>Док. №</th></tr></thead><tbody>
        ${list.slice(0,12).map(r=>`<tr class="${!r.product?"badrow":""}"><td>${r.line}</td><td>${esc(r.client)}</td><td>${esc(r.product)}</td><td class="mono">${esc(r.serial)||"<span class='note'>—</span>"}</td><td>${r.replaced==="yes"?"Да":"Не"}</td><td>${pill(r.status)}</td><td>${r.date?fmt(r.date).split(" ")[0]:"<span class='note'>днес</span>"}</td><td>${r.invoiceDate?bgd(r.invoiceDate):""}</td><td class="mono">${esc(r.doc)}</td></tr>`).join("")}
      </tbody></table></div>
      ${list.length>12?`<div class="note">… и още ${list.length-12} реда</div>`:""}
    </div>
    <div id="impRes"></div>`;
  const go=$("#impGo");go.hidden=false;go.disabled=!(list.length-bad.length)||!imp.dept;go.textContent=`Импортирай ${list.length-bad.length} ремонта`;
  const sh=$("#impSheet");if(sh)sh.onchange=()=>{imp.sheet=sh.value;useSheet()};
  $("#impDept").onchange=e=>{imp.dept=e.target.value;drawImport()};
  $("#impStep").querySelectorAll("[data-map]").forEach(sel=>sel.onchange=()=>{const k=sel.dataset.map;if(sel.value==="")delete imp.map[k];else imp.map[k]=+sel.value;drawImport()});
  $("#impStep").querySelectorAll("[data-op]").forEach(sel=>sel.onchange=()=>{const k=sel.dataset.op;if(sel.value==="")delete imp.ops[k];else imp.ops[k]=+sel.value;drawImport()});
  $("#impStep").querySelectorAll("[data-sv]").forEach(sel=>sel.onchange=()=>{imp.smap[sel.dataset.sv]=sel.value;drawImport()});
  const d=$("#impDef");if(d)d.onchange=()=>{imp.defStatus=d.value;drawImport()};
}
async function runImport(){
  const list=imp.rows.map(mapped).filter(r=>r.product);
  const go=$("#impGo");go.disabled=true;
  const tot={created:0,skipped:0,errors:[]};
  for(let i=0;i<list.length;i+=10){
    go.textContent=`Импортиране… ${Math.min(i+10,list.length)} / ${list.length}`;
    try{const r=await api("import/repairs",{department:imp.dept,file:imp.file,rows:list.slice(i,i+10)});tot.created+=r.created;tot.skipped+=r.skipped;tot.errors.push(...r.errors)}
    catch(e){tot.errors.push(`Редове ${list[i].line}–${list[Math.min(i+9,list.length-1)].line}: ${e.message}`)}
  }
  await refresh();
  go.textContent="Готово";
  $("#impRes").innerHTML=`<div class="sect"><h3>Резултат</h3><div class="estat on">✓ Импортирани: ${tot.created}</div>
    ${tot.skipped?`<div class="note">Пропуснати (вече ги има): ${tot.skipped}</div>`:""}
    ${tot.errors.length?`<div class="warn">${tot.errors.slice(0,20).map(esc).join("<br>")}</div>`:""}</div>`;
  $("#impRes").scrollIntoView({block:"center"});
  toast(`Импортирани ${tot.created} ремонта.`);
}

/* ---------- календар: отпуски, болнични, командировки ---------- */
// approval: заявката отива като тикет към отдел „Управител“ и чака одобрение
const ATYPES=[
  {k:"vacation",l:"Платена отпуска",s:"отпуска",c:"--st-green",approval:true},
  {k:"unpaid",l:"Неплатена отпуска",s:"неплатена",c:"--st-cyan",approval:true},
  {k:"sick",l:"Болничен",s:"болничен",c:"--st-red"},
  {k:"dayoff",l:"Почивен ден",s:"почивен ден",c:"--lv-purple"},
  {k:"trip",l:"Командировка",s:"командировка",c:"--st-blue"},
  {k:"other",l:"Друго",s:"отсъства",c:"--st-grey"}];
const atype=k=>ATYPES.find(x=>x.k===k)||ATYPES[ATYPES.length-1];
const MGR_DEPT="Управител";
const isApprover=()=>me.isAdmin||dname(myDept()).toLowerCase()===MGR_DEPT.toLowerCase();
const AST={pending:"Изчаква одобрение",approved:"Одобрена",rejected:"Отказана",cancelled:"Отменена"};
const ASTC={pending:"--st-orange",approved:"--st-green",rejected:"--st-red",cancelled:"--st-grey"};
const MONTHS=["Януари","Февруари","Март","Април","Май","Юни","Юли","Август","Септември","Октомври","Ноември","Декември"];
const WD=["Пн","Вт","Ср","Чт","Пт","Сб","Нд"];
// Официални празници (както на сървъра): Великден по православния календар, пренасяне на почивните дни от събота/неделя
const isoOf=d=>d.toISOString().slice(0,10),addDay=(d,n)=>new Date(d.getTime()+n*864e5);
function easterOf(y){const a=y%4,b=y%7,c=y%19,d=(19*c+15)%30,e=(2*a+4*b-d+34)%7,m=Math.floor((d+e+114)/31),day=((d+e+114)%31)+1;return new Date(Date.UTC(y,m-1,day+13))}
const HCACHE={};
function holidays(y){
  if(HCACHE[y])return HCACHE[y];
  const fixed=[["01-01","Нова година"],["03-03","Освобождението"],["05-01","Ден на труда"],["05-06","Гергьовден"],["05-24","Ден на писмеността"],["09-06","Съединението"],["09-22","Независимостта"],["12-24","Бъдни вечер"],["12-25","Коледа"],["12-26","Коледа"]];
  const h=new Map(fixed.map(([md,n])=>[`${y}-${md}`,n])),e=easterOf(y);
  [[-2,"Велики петък"],[-1,"Велика събота"],[0,"Великден"],[1,"Великден"]].forEach(([k,n])=>h.set(isoOf(addDay(e,k)),n));
  const wk=d=>{const w=d.getUTCDay();return w===0||w===6};
  for(const [md,n] of fixed){const d=new Date(`${y}-${md}T00:00:00Z`);if(!wk(d))continue;let x=addDay(d,1);while(wk(x)||h.has(isoOf(x)))x=addDay(x,1);h.set(isoOf(x),n+" (почивен)")}
  return HCACHE[y]=h;
}
const holidayName=iso=>holidays(+iso.slice(0,4)).get(iso)||"";
const isWeekend=iso=>{const w=new Date(iso+"T00:00:00Z").getUTCDay();return w===0||w===6};
const isWork=iso=>!isWeekend(iso)&&!holidayName(iso);
function workDaysBetween(a,b){if(!a||!b||b<a)return 0;let n=0;for(let d=new Date(a+"T00:00:00Z"),e=new Date(b+"T00:00:00Z");d<=e;d=addDay(d,1))if(isWork(isoOf(d)))n++;return n}
const period=a=>a.from===a.to?bgd(a.from):`${bgd(a.from)} – ${bgd(a.to)}`;
const daysTxtW=n=>`${n} ${n===1?"работен ден":"работни дни"}`;
const live=a=>a.status==="pending"||a.status==="approved";
const awayOn=(uid,iso)=>absences.find(a=>a.user===uid&&a.status==="approved"&&a.from<=iso&&a.to>=iso);
const shortName=id=>{const p=String(uname(id)).split(/\s+/);return p.length>1?`${p[0]} ${p[p.length-1][0]}.`:p[0]};
const aPill=s=>`<span class="pill solid" style="background:var(${ASTC[s]||"--st-grey"})"><span class="dot"></span>${AST[s]||s}</span>`;
const canCancel=a=>live(a)&&(a.user===me.id||a.by===me.id||isApprover());

const cal={y:new Date().getFullYear(),m:new Date().getMonth()};
$("#calPrev").onclick=()=>{cal.m--;if(cal.m<0){cal.m=11;cal.y--}renderCalendar()};
$("#calNext").onclick=()=>{cal.m++;if(cal.m>11){cal.m=0;cal.y++}renderCalendar()};
$("#calToday").onclick=()=>{const d=new Date();cal.y=d.getFullYear();cal.m=d.getMonth();renderCalendar()};
$("#calUser").addEventListener("input",()=>renderCalendar());

function renderCalendar(){
  const cu=$("#calUser");
  syncSelect(cu,`<option value="">Целият екип</option><option value="me">Само моите</option>`+team().map(u=>`<option value="${esc(u.id)}">${esc(u.name)}</option>`).join(""),v=>v==="me"||!!user(v));
  const who=cu.value==="me"?me.id:cu.value;
  $("#calTitle").textContent=`${MONTHS[cal.m]} ${cal.y}`;
  $("#calLegend").innerHTML=ATYPES.map(t=>`<span class="lg"><i style="background:var(${t.c})"></i>${t.l}${t.approval?" *":""}</span>`).join("")
    +`<span class="lg"><i class="hatch" style="--ac:var(--st-green)"></i>Изчаква одобрение</span><span class="lg"><i class="hol"></i>Празник</span><span class="note">* иска одобрение от отдел „${MGR_DEPT}“</span>`;

  // за одобрение – само за управителите
  const pend=absences.filter(a=>a.status==="pending").sort((a,b)=>a.from.localeCompare(b.from));
  const pp=$("#calPending");
  pp.innerHTML=isApprover()&&pend.length?`<div class="apanel warnp"><div class="aph"><b>Чакат вашето одобрение (${pend.length})</b><span class="note">Отпуските отиват като тикети към отдел „${MGR_DEPT}“.</span></div>
    ${pend.map(a=>`<div class="arow">${av(a.user)}<div class="ainfo"><b>${esc(uname(a.user))}</b> · ${esc(atype(a.type).l)}<div>${period(a)} · <b>${daysTxtW(a.days)}</b>${a.note?` · <span class="note">„${esc(a.note)}“</span>`:""}</div>${clashTxt(a)}</div>
      <div class="abtns"><button type="button" class="okb" data-dec="approve" data-a="${esc(a.id)}">Одобри</button><button type="button" class="nob" data-dec="reject" data-a="${esc(a.id)}">Откажи</button>${a.ticket?`<button type="button" data-tk="${esc(a.ticket)}">Отвори</button>`:""}</div></div>`).join("")}</div>`:"";

  // месечна мрежа от понеделник до неделя
  const first=new Date(Date.UTC(cal.y,cal.m,1)),last=new Date(Date.UTC(cal.y,cal.m+1,0));
  let d=addDay(first,-((first.getUTCDay()+6)%7));const end=addDay(last,(7-last.getUTCDay())%7);
  const today=todayStr(),list=absences.filter(a=>live(a)&&(!who||a.user===who));
  let html=WD.map((w,i)=>`<div class="cwd ${i>4?"we":""}">${w}</div>`).join("");
  for(;d<=end;d=addDay(d,1)){
    const iso=isoOf(d),hn=holidayName(iso),out=d.getUTCMonth()!==cal.m,we=isWeekend(iso);
    // на почивни дни показваме само отсъствия, които са изцяло в почивни дни (напр. командировка в събота)
    const items=list.filter(a=>a.from<=iso&&a.to>=iso&&(isWork(iso)||!a.days)).sort((a,b)=>a.user.localeCompare(b.user));
    html+=`<div class="cday ${out?"out":""} ${we?"we":""} ${hn?"hol":""} ${iso===today?"today":""}" data-day="${iso}">
      <div class="cdn"><span>${d.getUTCDate()}</span>${hn?`<span class="hn" title="${esc(hn)}">${esc(hn)}</span>`:""}</div>
      ${items.slice(0,4).map(a=>`<button type="button" class="ach ${a.status==="pending"?"pend":""}" style="--ac:var(${atype(a.type).c})" data-a="${esc(a.id)}" title="${esc(uname(a.user))} · ${esc(atype(a.type).l)} · ${period(a)}${a.status==="pending"?" · изчаква одобрение":""}"><span class="an">${esc(shortName(a.user))}</span><span class="at">${a.status==="pending"?"чака":esc(atype(a.type).s)}</span></button>`).join("")}
      ${items.length>4?`<button type="button" class="amore" data-day="${iso}">+${items.length-4} още</button>`:""}</div>`;
  }
  $("#calGrid").innerHTML=html;

  // моите заявки и използвани дни през годината
  const y=String(cal.y),mine=absences.filter(a=>a.user===me.id).sort((a,b)=>b.from.localeCompare(a.from));
  const used=t=>absences.filter(a=>a.user===me.id&&a.type===t&&a.status==="approved"&&a.from.startsWith(y)).reduce((s,a)=>s+a.days,0);
  const pendDays=absences.filter(a=>a.user===me.id&&a.status==="pending"&&a.from.startsWith(y)).reduce((s,a)=>s+a.days,0);
  $("#calMine").innerHTML=`<div class="apanel"><div class="aph"><b>Моите отсъствия</b><span class="note">През ${y}: платена отпуска <b>${used("vacation")}</b> дни${used("unpaid")?`, неплатена <b>${used("unpaid")}</b>`:""}${used("sick")?`, болничен <b>${used("sick")}</b>`:""}${pendDays?` · чакат одобрение <b>${pendDays}</b>`:""}</span></div>
    ${mine.length?mine.slice(0,15).map(a=>`<div class="arow">${`<span class="tdot" style="background:var(${atype(a.type).c})"></span>`}<div class="ainfo"><b>${esc(atype(a.type).l)}</b> · ${period(a)}${a.days?` · ${daysTxtW(a.days)}`:""}${a.note?`<div class="note">„${esc(a.note)}“</div>`:""}${a.decisionNote?`<div class="note">${a.status==="rejected"?"Причина":"Коментар"}: „${esc(a.decisionNote)}“ – ${esc(uname(a.decidedBy))}</div>`:""}</div>
      <div class="abtns">${a.ticket||atype(a.type).approval?aPill(a.status):""}${a.ticket&&tickets.some(t=>t.id===a.ticket)?`<button type="button" data-tk="${esc(a.ticket)}">Тикет</button>`:""}${canCancel(a)?`<button type="button" class="nob ghost" data-cancel="${esc(a.id)}">${a.ticket?"Отмени":"Премахни"}</button>`:""}</div></div>`).join("")
      :`<div class="note">Нямате въведени отсъствия. Натиснете „+ Отсъствие“ или ден от календара.</div>`}</div>`;
}
// кой друг отсъства в същите дни – помага на управителя да реши
function clashTxt(a){
  const o=absences.filter(x=>x.id!==a.id&&x.user!==a.user&&live(x)&&x.from<=a.to&&x.to>=a.from);
  return o.length?`<div class="clash">В същия период отсъстват: ${o.map(x=>`${esc(uname(x.user))} (${esc(atype(x.type).s)}${x.status==="pending"?", чака":""}, ${period(x)})`).join("; ")}</div>`:"";
}
$("#calView").addEventListener("click",async e=>{
  const dec=e.target.closest("[data-dec]");if(dec){decide(dec.dataset.a,dec.dataset.dec,"",dec);return}
  const tk=e.target.closest("[data-tk]");if(tk){openTicket(tk.dataset.tk);return}
  const c=e.target.closest("[data-cancel]");if(c){cancelAbsence(c.dataset.cancel,c);return}
  const ch=e.target.closest(".ach[data-a]");if(ch){openAbsenceInfo(ch.dataset.a);return}
  const mo=e.target.closest(".amore");if(mo){openDay(mo.dataset.day);return}
  const day=e.target.closest(".cday[data-day]");if(day)openAbsence({from:day.dataset.day});
});
async function decide(id,decision,note,btn){
  if(btn)btn.disabled=true;
  try{await api("absences/decide",{id,decision,note});await refresh();toast(decision==="approve"?"Отпуската е одобрена":"Отпуската е отказана");if(!$("#drawer").hidden&&ui.openId){const t=tickets.find(x=>x.id===ui.openId);if(t&&t.kind==="leave")openLeave(t)}}
  catch(err){if(btn)btn.disabled=false;toast(err.message)}
}
async function cancelAbsence(id,btn){
  const a=absences.find(x=>x.id===id);if(!a)return;
  if(!btn.dataset.sure){btn.dataset.sure="1";const old=btn.textContent;btn.textContent="Потвърди";setTimeout(()=>{if(btn.isConnected){btn.textContent=old;delete btn.dataset.sure}},4000);return}
  btn.disabled=true;
  try{await api("absences/cancel",{id});await refresh();toast(a.ticket?"Заявката е отменена":"Отсъствието е премахнато");
    if(!$("#drawer").hidden){const t=a.ticket&&tickets.find(x=>x.id===a.ticket);if(t&&ui.openId===t.id)openLeave(t);else closeDrawer()}}
  catch(err){btn.disabled=false;toast(err.message)}
}
function openDay(iso){
  const its=absences.filter(a=>live(a)&&a.from<=iso&&a.to>=iso);
  showDrawer(`<div class="dh"><h2>${bgd(iso)}${holidayName(iso)?` · ${esc(holidayName(iso))}`:""}</h2><button type="button" data-x aria-label="Затвори">✕</button></div>
    <div class="db stack">${its.map(a=>`<button type="button" class="arow abtn" data-a="${esc(a.id)}">${av(a.user)}<div class="ainfo"><b>${esc(uname(a.user))}</b> · ${esc(atype(a.type).l)}<div>${period(a)}</div></div>${a.status==="pending"?aPill("pending"):""}</button>`).join("")||`<div class="note">Никой не отсъства.</div>`}</div>
    <div class="df"><div class="r"><button type="button" data-x>Затвори</button><button type="button" class="primary" id="dayAdd">+ Отсъствие</button></div></div>`);
  $("#drawer").querySelectorAll(".abtn").forEach(b=>b.onclick=()=>openAbsenceInfo(b.dataset.a));
  $("#dayAdd").onclick=()=>openAbsence({from:iso});
}
function openAbsenceInfo(id){
  const a=absences.find(x=>x.id===id);if(!a)return;
  const t=a.ticket&&tickets.find(x=>x.id===a.ticket);if(t){openTicket(t.id);return}
  ui.openId=null;
  showDrawer(`<div class="dh"><h2>${esc(atype(a.type).l)}</h2><button type="button" data-x aria-label="Затвори">✕</button></div>
    <div class="db stack">${absCard(a)}</div>
    <div class="df">${canCancel(a)?`<button type="button" class="danger" id="aDel">Премахни</button>`:""}<div class="r"><button type="button" data-x>Затвори</button></div></div>`);
  const b=$("#aDel");if(b)b.onclick=()=>cancelAbsence(a.id,b);
}
function absCard(a){
  return `<div class="rsum acard"><dl>
    <dt>Служител</dt><dd><span class="who">${av(a.user)}${esc(uname(a.user))}</span></dd>
    <dt>Вид</dt><dd><span class="tdot" style="background:var(${atype(a.type).c})"></span>${esc(atype(a.type).l)}</dd>
    <dt>Период</dt><dd><b>${period(a)}</b>${a.days?` · ${daysTxtW(a.days)}`:""}</dd>
    ${a.note?`<dt>Бележка</dt><dd>${esc(a.note)}</dd>`:""}
    <dt>Статус</dt><dd>${atype(a.type).approval||a.ticket?aPill(a.status):"Записано в календара"}</dd>
    ${a.decidedBy?`<dt>${a.status==="rejected"?"Отказал":"Одобрил"}</dt><dd>${esc(uname(a.decidedBy))} · ${fmt(a.decidedAt)}${a.decisionNote?`<div class="note">„${esc(a.decisionNote)}“</div>`:""}</dd>`:""}
    <dt>Въведено</dt><dd>${fmt(a.createdAt)}${a.by&&a.by!==a.user?` от ${esc(uname(a.by))}`:""}</dd>
  </dl></div>${clashTxt(a)}`;
}
// Тикет „заявка за отпуска“ – вместо обикновената бланка
function openLeave(t){
  const a=absences.find(x=>x.ticket===t.id);
  const pend=a&&a.status==="pending";
  showDrawer(`<div class="dh"><h2><span class="mono">${tno(t.no)}</span> Заявка за отпуска</h2><button type="button" data-x aria-label="Затвори">✕</button></div>
    <div class="db stack">
      ${a?absCard(a):`<div class="rsum"><div class="pre">${esc(t.description)}</div></div>`}
      ${pend&&isApprover()?`<div class="apanel warnp"><div class="aph"><b>Решение</b><span class="note">Служителят ще получи известие.</span></div>
        <label class="f">Коментар (по желание; при отказ – причината)<textarea id="lv_note" rows="2"></textarea></label>
        <div class="abtns"><button type="button" class="okb" id="lvOk">Одобри</button><button type="button" class="nob" id="lvNo">Откажи</button></div></div>`
        :pend?`<div class="note">Заявката чака одобрение от отдел „${MGR_DEPT}“. Докато не бъде одобрена, в календара е с щрихи.</div>`:""}
      ${threadHtml(t)}
      ${changesHtml(t)}
    </div>
    <div class="df">${(t.reporter===me.id||me.isAdmin)?`<button type="button" class="danger" id="delT">Изтрий</button>`:""}<div class="r">${a&&canCancel(a)?`<button type="button" id="lvCancel">Отмени заявката</button>`:""}<button type="button" data-x>Затвори</button></div></div>`);
  bindThread(t);
  const ok=$("#lvOk");if(ok){ok.onclick=()=>decide(a.id,"approve",$("#lv_note").value.trim(),ok);$("#lvNo").onclick=()=>decide(a.id,"reject",$("#lv_note").value.trim(),$("#lvNo"))}
  const c=$("#lvCancel");if(c)c.onclick=()=>cancelAbsence(a.id,c);
  const del=$("#delT");if(del)del.onclick=()=>{if(del.dataset.sure)deleteTicket(t);else{del.dataset.sure="1";del.textContent="Потвърди изтриване";setTimeout(()=>{if(del.isConnected){del.textContent="Изтрий";delete del.dataset.sure}},4000)}};
}
function openAbsence(preset){
  preset=preset||{};ui.openId=null;
  const from=preset.from||todayStr();
  showDrawer(`<div class="dh"><h2>Ново отсъствие</h2><button type="button" data-x aria-label="Затвори">✕</button></div>
    <div class="db stack" id="af">
      ${isApprover()?`<label class="f">Служител<select id="a_user">${team().map(u=>`<option value="${esc(u.id)}" ${u.id===me.id?"selected":""}>${esc(u.name)}${u.id===me.id?" (аз)":""}</option>`).join("")}</select></label>`:""}
      <div class="f"><span>Вид</span><div class="atypes" role="radiogroup">${ATYPES.map((t,i)=>`<label class="atype" style="--ac:var(${t.c})"><input type="radio" name="a_type" value="${t.k}" ${i===0?"checked":""}><span>${t.l}</span></label>`).join("")}</div></div>
      <div class="g2"><label class="f">От${dateIn("a_from",from)}</label><label class="f">До (включително)${dateIn("a_to",preset.to||from)}</label></div>
      <div class="ainfo2" id="a_info"></div>
      <label class="f">Бележка<textarea id="a_note" rows="3" placeholder="По желание: причина, кой ви замества, телефон за връзка…"></textarea></label>
    </div>
    <div class="df"><div class="r"><button type="button" data-x>Отказ</button><button type="button" class="primary" id="aSave">Запиши</button></div></div>`);
  const info=()=>{
    const t=atype(($("input[name=a_type]:checked")||{}).value),f=bgToIso($("#a_from").value),to=bgToIso($("#a_to").value)||f;
    const n=f&&to&&to>=f?workDaysBetween(f,to):0;
    $("#a_info").innerHTML=(f&&to&&to<f?`<div class="clash">Крайната дата е преди началната.</div>`:f?`<b>${daysTxtW(n)}</b> <span class="note">(без събота, неделя и официалните празници)</span>`:"")
      +`<div class="${t.approval?"apnote":"note"}">${t.approval?`Ще отиде като тикет към отдел „${MGR_DEPT}“ и ще стои като <b>изчакваща одобрение</b>, докато управителят не я одобри.`:"Записва се направо в календара, без одобрение."}</div>`
      +(f&&to>=f?clashTxt({id:"",user:($("#a_user")||{}).value||me.id,from:f,to}):"");
    $("#aSave").textContent=t.approval?"Изпрати за одобрение":"Запиши";
  };
  $("#af").addEventListener("input",info);$("#af").addEventListener("change",info);
  // „До“ следва „От“, ако е останало по-рано
  $("#a_from").addEventListener("focusout",()=>{const f=bgToIso($("#a_from").value),t=bgToIso($("#a_to").value);if(f&&(!t||t<f))dset("#a_to",f);info()});
  info();
  $("#aSave").onclick=async()=>{
    const from=dval("#a_from","От дата");if(from===null)return;if(!from){toast("Изберете от коя дата.");return}
    const to=dval("#a_to","До дата");if(to===null)return;
    const b=$("#aSave");b.disabled=true;
    try{
      const r=await api("absences/save",{user:($("#a_user")||{}).value||me.id,type:$("input[name=a_type]:checked").value,from,to:to||from,note:$("#a_note").value.trim()});
      await refresh();closeDrawer();const d=new Date(from);cal.y=d.getFullYear();cal.m=d.getMonth();render();
      toast(r.pending?"Заявката е изпратена за одобрение":"Записано в календара");
    }catch(e){b.disabled=false;toast(e.message)}
  };
}

/* ---------- notifications (bell) ---------- */
const canPop=()=>"Notification" in window;
function notifText(n){
  const t=tickets.find(x=>x.id===n.ticket),no=t?tno(t.no):"тикет",by=uname(n.by);
  if(n.type==="note")return {head:`${by} добави бележка към ${no}`,body:n.text?`„${n.text}“`:(t?t.title:"")};
  if(n.type==="leave_req")return {head:`${by} иска отпуска – чака вашето одобрение`,body:t?t.title:(n.text||"")};
  if(n.type==="leave_ok")return {head:`${by} одобри вашата отпуска`,body:(t?t.title:"")+(n.reason?` – „${n.reason}“`:"")};
  if(n.type==="leave_no")return {head:`${by} отказа вашата отпуска`,body:(t?t.title:"")+(n.reason?` – „${n.reason}“`:"")};
  if(n.type==="leave_cancel")return {head:`${by} отмени отпуска`,body:t?t.title:""};
  return {head:`${by} ${n.type==="transferred"?"ви прехвърли":"ви възложи"} ${no}`,body:(t?t.title:"")+(n.reason?` – „${n.reason}“`:"")};
}
function renderBell(){
  const unread=notifs.filter(n=>!n.read).length,b=$("#bellN");
  b.hidden=!unread;b.textContent=unread>9?"9+":unread;
  $("#btnBell").classList.toggle("has",!!unread);
  document.title=(unread?`(${unread}) `:"")+"Сервизни тикети";
  if(!$("#bellPanel").hidden)drawBellPanel();
}
function drawBellPanel(){
  const p=$("#bellPanel"),perm=canPop()?Notification.permission:"unsupported";
  p.innerHTML=`<div class="bhead"><b>Известия</b>${notifs.some(n=>!n.read)?`<button type="button" id="bAll">Маркирай всички като прочетени</button>`:""}</div>
    ${perm==="default"?`<div class="bperm"><span>Искате ли изскачащи известия, докато системата е отворена (и в друг раздел)?</span><button type="button" class="primary" id="bPerm">Включи</button></div>`
      :perm==="denied"?`<div class="bperm note">Изскачащите известия са забранени в браузъра. Разрешете ги от иконата с катинарчето до адреса.</div>`:""}
    <div class="blist">${notifs.length?notifs.map(n=>{const x=notifText(n);return `<button type="button" class="bitem ${n.read?"":"unread"}" data-nid="${esc(n.id)}" data-tid="${esc(n.ticket)}">
      ${av(n.by)}<span class="btext"><b>${esc(x.head)}</b><span>${esc(x.body)}</span><span class="note">${fmt(n.at)}</span></span></button>`}).join("")
      :`<div class="bempty">Няма известия. Тук ще виждате, когато колега ви възложи или прехвърли тикет, или добави бележка към ваш тикет.</div>`}</div>`;
  const a=$("#bAll");if(a)a.onclick=async()=>{notifs.forEach(n=>n.read=true);renderBell();cacheSave();try{await api("notifications/read",{all:true})}catch(e){}};
  const pb=$("#bPerm");if(pb)pb.onclick=async()=>{try{await Notification.requestPermission()}catch(e){}drawBellPanel();if(canPop()&&Notification.permission==="granted")toast("Изскачащите известия са включени.")};
}
async function openNotif(nid,tid){
  const n=notifs.find(x=>x.id===nid);if(n&&!n.read){n.read=true;renderBell();cacheSave();api("notifications/read",{ids:[nid]}).catch(()=>{})}
  $("#bellPanel").hidden=true;$("#btnBell").setAttribute("aria-expanded","false");
  const t=tickets.find(x=>x.id===tid);if(!t){toast("Тикетът вече не съществува.");return}
  ui.view=t.kind==="repair"?"repairs":t.kind==="leave"?"calendar":(t.assignee===me.id?"mine":"all");render();openTicket(t.id);
}
$("#btnBell").onclick=e=>{e.stopPropagation();const p=$("#bellPanel");p.hidden=!p.hidden;$("#btnBell").setAttribute("aria-expanded",String(!p.hidden));if(!p.hidden)drawBellPanel()};
$("#bellPanel").addEventListener("click",e=>{e.stopPropagation();const b=e.target.closest("[data-nid]");if(b)openNotif(b.dataset.nid,b.dataset.tid)});
document.addEventListener("click",()=>{const p=$("#bellPanel");if(!p.hidden){p.hidden=true;$("#btnBell").setAttribute("aria-expanded","false")}});
document.addEventListener("keydown",e=>{if(e.key==="Escape")$("#bellPanel").hidden=true});
// Нови известия след последната проверка: изскачащо известие (ако е разрешено и разделът не е отпред) или съобщение в страницата
function announce(){
  const ids=new Set(notifs.map(n=>n.id));
  if(seenNotif===null){seenNotif=ids;return}
  const fresh=notifs.filter(n=>!n.read&&!seenNotif.has(n.id));seenNotif=ids;
  if(!fresh.length)return;
  for(const n of fresh.slice(0,3)){
    const x=notifText(n);
    if(canPop()&&Notification.permission==="granted"&&document.visibilityState!=="visible"){
      try{const pop=new Notification(x.head,{body:x.body,tag:"tk-"+n.id});pop.onclick=()=>{window.focus();openNotif(n.id,n.ticket);pop.close()}}catch(e){}
    }
  }
  if(document.visibilityState==="visible")toast(fresh.length===1?notifText(fresh[0]).head:`Имате ${fresh.length} нови известия`);
}

/* ---------- start ---------- */
render();
refresh().then(()=>{const m=location.hash.match(/^#t-(\d+)$/);if(m){history.replaceState(null,"",location.pathname);const t=tickets.find(x=>x.id===m[1]);if(t){ui.view=t.kind==="repair"?"repairs":"all";render();openTicket(t.id)}else toast("Тикетът не е намерен.")}});
// Проверка на всеки 30 сек; когато разделът е на заден план – на всеки 60 сек.
// След собствено действие и при връщане към раздела се проверява веднага.
let tick=0;setInterval(()=>{tick++;if(document.visibilityState==="visible"||tick%2===0)refresh()},30000);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")refresh()});
