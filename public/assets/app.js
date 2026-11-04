"use strict";
const STATUSES=[
  {k:"new",l:"Нов",c:"--new"},{k:"work",l:"В работа",c:"--work"},{k:"wait",l:"Чака клиент",c:"--wait"},
  {k:"done",l:"Решен",c:"--done"},{k:"closed",l:"Затворен",c:"--closed"}];
const CLOSED=new Set(["done","closed"]);
const PRIOS=[{k:4,l:"Спешен",c:"--crit"},{k:3,l:"Висок",c:"--work"},{k:2,l:"Среден",c:"--new"},{k:1,l:"Нисък",c:"--closed"}];
const AVC=["#0d5c7a","#a0522d","#5b6b2f","#7a3d8c","#2f5f9e","#8a5a00","#3d6b6b"];

let me={id:"",name:"",isAdmin:false}, users=[], companies=[], tickets=[], departments=[], loaded=false, maxUsers=7;
const ui={view:"mine",open:"open",status:"",user:"",openId:null};
try{const v=localStorage.getItem("tk_view");if(["mine","all","companies"].includes(v))ui.view=v}catch(e){}

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
function pill(k){const s=st(k);return `<span class="pill" style="color:var(${s.c});background:var(${s.c}-bg)"><span class="dot" style="background:var(${s.c})"></span>${s.l}</span>`}
function prio(k){const p=pr(k);return `<span class="prio"><i style="background:var(${p.c})"></i>${p.l}</span>`}
function toast(msg){const t=$("#toast");t.textContent=msg;t.hidden=false;clearTimeout(toast.h);toast.h=setTimeout(()=>t.hidden=true,3200)}

/* ---------- server ---------- */
async function api(path,data){
  const opt=data===undefined?{}:{method:"POST",headers:{"Content-Type":"application/json","X-Tiketi":"1"},body:JSON.stringify(data)};
  const r=await fetch("/api/"+path,{...opt,credentials:"same-origin"});
  if(r.status===401){location.href="/login?expired=1";throw new Error("Сесията изтече.")}
  let j={};try{j=await r.json()}catch(e){}
  if(!r.ok||j.error)throw new Error(j.error||"Сървърът не отговори ("+r.status+").");
  return j;
}
async function refresh(){
  try{
    const s=await api("state");
    me=s.me;users=s.users;companies=s.companies;tickets=s.tickets;departments=s.departments||[];maxUsers=s.maxUsers;loaded=true;$("#warn").hidden=true;render();
  }catch(e){const w=$("#warn");w.hidden=false;w.textContent="Няма връзка със сървъра: "+e.message}
}

/* ---------- static filters ---------- */
$("#fPrio").innerHTML=`<option value="">Всички приоритети</option>`+PRIOS.map(p=>`<option value="${p.k}">${p.l}</option>`).join("");
["#q","#fPrio","#fCat","#fSort","#fComp","#fDept"].forEach(s=>$(s).addEventListener("input",render));
$("#cq").addEventListener("input",render);

/* ---------- view switching ---------- */
$("#views").addEventListener("click",e=>{const b=e.target.closest("[data-view]");if(!b)return;ui.view=b.dataset.view;ui.status="";ui.user="";try{localStorage.setItem("tk_view",ui.view)}catch(e){}render()});
$("#segOpen").addEventListener("click",e=>{const b=e.target.closest("[data-open]");if(!b)return;ui.open=b.dataset.open;ui.status="";render()});
$("#stats").addEventListener("click",e=>{const b=e.target.closest("[data-s]");if(!b)return;ui.status=ui.status===b.dataset.s?"":b.dataset.s;if(ui.status)ui.open="any";render()});
function teamPick(e){const c=e.target.closest("[data-u]");if(!c)return;ui.user=ui.user===c.dataset.u?"":c.dataset.u;render()}
$("#team").addEventListener("click",teamPick);
$("#team").addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();teamPick(e)}});
$("#rows").addEventListener("click",e=>{const r=e.target.closest("tr[data-id]");if(r)openTicket(r.dataset.id)});
$("#rows").addEventListener("keydown",e=>{const r=e.target.closest("tr[data-id]");if(r&&e.key==="Enter")openTicket(r.dataset.id)});
$("#crows").addEventListener("click",e=>{const r=e.target.closest("tr[data-id]");if(r)openCompany(r.dataset.id)});
$("#crows").addEventListener("keydown",e=>{const r=e.target.closest("tr[data-id]");if(r&&e.key==="Enter")openCompany(r.dataset.id)});

/* ---------- render ---------- */
function scopeTickets(){return ui.view==="mine"?tickets.filter(isMine):tickets}
function syncSelect(el,html,keep){const cur=el.value;el.innerHTML=html;el.value=keep(cur)?cur:""}
function render(){
  $("#meBox").innerHTML=`${av(me.id)}<span>${esc(me.name)}${me.isAdmin?" · админ":""}</span>`;
  const openAll=tickets.filter(t=>!CLOSED.has(t.status));
  $("#sub").textContent=loaded?`${tickets.length} тикета общо · ${openAll.length} отворени · ${openAll.filter(t=>!t.assignee).length} неразпределени · екип ${team().length}/${maxUsers}`:"Зареждане на данните…";
  $("#vcMine").textContent=loaded?openAll.filter(isMine).length:"";
  $("#vcAll").textContent=loaded?openAll.length:"";
  $("#vcComp").textContent=loaded?companies.length:"";
  document.querySelectorAll("#views [data-view]").forEach(b=>b.classList.toggle("on",b.dataset.view===ui.view));
  $("#btnExport").hidden=!tickets.length;
  const isComp=ui.view==="companies";
  $("#ticketsView").hidden=isComp;$("#companiesView").hidden=!isComp;
  if(isComp){renderCompanies();return}

  document.querySelectorAll("#segOpen [data-open]").forEach(b=>b.classList.toggle("on",b.dataset.open===ui.open));

  const scope=scopeTickets();
  const cnt=k=>scope.filter(t=>t.status===k).length;
  $("#stats").innerHTML=STATUSES.map(s=>`<button type="button" class="stat ${ui.status===s.k?"on":""}" data-s="${s.k}"><span class="n">${loaded?cnt(s.k):"–"}</span><span class="l"><span class="dot" style="background:var(${s.c})"></span>${s.l}</span></button>`).join("");

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
      +ord.map(u=>`<span class="chip ${ui.user===u.id?"on":""}" role="button" tabindex="0" data-u="${esc(u.id)}">${av(u.id)}${u.id===me.id?"Аз":esc(u.name)} <span class="c">${openAll.filter(x=>x.assignee===u.id).length}</span></span>`).join("");
  }else t.hidden=true;

  // company filter options (kept in sync)
  const fc=$("#fComp"),cur=fc.value;
  fc.innerHTML=`<option value="">Всички компании</option>`+companies.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
  fc.value=comp(cur)?cur:"";

  const q=$("#q").value.trim().toLowerCase(), fp=$("#fPrio").value, fcat=$("#fCat").value, fco=fc.value, so=$("#fSort").value;
  let list=scope.filter(x=>
    (ui.status?x.status===ui.status:ui.open==="open"?!CLOSED.has(x.status):ui.open==="closed"?CLOSED.has(x.status):true)
    &&(ui.view!=="all"||!ui.user||(ui.user==="none"?!x.assignee:x.assignee===ui.user))
    &&(!fdv||x.department===fdv)
    &&(!fp||String(x.priority)===fp)&&(!fcat||x.category===fcat)&&(!fco||x.company===fco)
    &&(!q||[tno(x.no),x.title,x.description,cname(x.company),x.site,dname(x.department)].join(" ").toLowerCase().includes(q)));
  const by={new:(a,b)=>b.no-a.no,old:(a,b)=>a.no-b.no,prio:(a,b)=>(b.priority-a.priority)||(b.no-a.no),upd:(a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))};
  list.sort(by[so]);
  $("#rows").innerHTML=list.map(x=>{const sub=[cname(x.company),x.site].filter(Boolean).join(" · ");const dc=[dname(x.department),x.category].filter(Boolean).join(" / ");return `<tr tabindex="0" data-id="${esc(x.id)}">
    <td class="no">${tno(x.no)}</td>
    <td><div class="ttl">${esc(x.title)}</div>${(sub||dc)?`<div class="obj">${dc?`<span class="dtag">${esc(dc)}</span>`:""}${esc(sub)}</div>`:""}<div class="desc">${esc(x.description)}</div></td>
    <td>${pill(x.status)}</td><td>${prio(x.priority)}</td>
    <td>${x.assignee?`<span class="who">${av(x.assignee)}${x.assignee===me.id?"Аз":esc(uname(x.assignee))}</span>`:`<span class="unas">Неразпределен</span>`}</td>
    <td><span class="who">${x.reporter===me.id?"Аз":esc(uname(x.reporter))}</span></td>
    <td class="date">${fmt(x.createdAt)}</td></tr>`}).join("");
  const em=$("#empty");
  if(!loaded){em.hidden=false;em.innerHTML="<b>Зареждане на тикетите…</b>"}
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
function ticketForm(t,preset){
  const isNew=!t; t=t||{status:"new",priority:2,category:"",reporter:me.id,assignee:"",company:"",site:"",department:myDept()||(departments[0]||{}).id||"",...(preset||{})};
  const asgBlock=isNew
    ?`<div class="asg"><span class="lab">Насочи към</span>
        <select id="t_asg"><option value="">Свободен в отдела (без отговорник)</option>${targetOpts(false)}</select>
        <textarea id="t_reason" placeholder="Указания към колегата (по желание)"></textarea></div>`
    :`<div class="asg"><div class="row">
        <div><div class="lab">Отговорник${dname(t.department)?" · отдел "+esc(dname(t.department)):""}</div><div class="cur">${t.assignee?`${av(t.assignee)}${esc(uname(t.assignee))}${t.assignee===me.id?" (аз)":""}`:`<span class="unas">Свободен – чака някой от отдела да го поеме</span>`}</div></div>
        <div class="btns">${t.assignee!==me.id?`<button type="button" id="btnTake">Поеми тикета</button>`:""}<button type="button" id="btnTrf">Прехвърли…</button></div></div>
        <div class="trf" id="trf" hidden>
          <label class="f">Прехвърли към<select id="trf_to"><option value="__">Изберете служител или отдел…</option>${t.assignee?`<option value="">Освободи – остава свободен в отдела</option>`:""}${targetOpts(true)}</select></label>
          <label class="f">Причина / указания<textarea id="trf_reason" placeholder="Напр. Нужен е техник за пожароизвестяване"></textarea></label>
          <div class="btns"><button type="button" class="primary" id="trfGo">Прехвърли</button><button type="button" id="trfNo">Отказ</button></div>
        </div></div>`;
  return `<div class="dh"><h2>${isNew?"Нов тикет":`<span class="no">${tno(t.no)}</span> ${esc(t.title)}`}</h2><button type="button" data-x aria-label="Затвори">✕</button></div>
  <form class="db" id="tf">
    ${isNew?"":`<div class="meta">Създаден ${fmt(t.createdAt)} от ${esc(uname(t.reporter))} · Обновен ${fmt(t.updatedAt)}</div>`}
    ${asgBlock}
    <label class="f"><span>Заглавие <span class="req">*</span></span><input id="t_title" required maxlength="140" value="${esc(t.title||"")}" placeholder="Напр. Централата не се включва под охрана"></label>
    <label class="f"><span>Описание на проблема <span class="req">*</span></span><textarea id="t_desc" required placeholder="Какво се случва, от кога, кои зони или камери, кодове на грешки, какво е опитано досега…">${esc(t.description||"")}</textarea></label>
    <div class="g2">
      <label class="f">Компания<select id="t_comp">${compOpts(t.company)}</select></label>
      <label class="f">Обект<input id="t_site" maxlength="160" list="t_sites" value="${esc(t.site||"")}" placeholder="Напр. Склад Плевен"><datalist id="t_sites"></datalist></label>
    </div>
    <div id="t_cinfo">${compInfo(t.company)}</div>
    <div class="g2">
      <label class="f">Отдел<select id="t_dept">${deptOpts(t.department)}</select></label>
      <label class="f">Категория<select id="t_cat">${catOpts(t.department,t.category)}</select></label>
      <label class="f">Приоритет<select id="t_prio">${PRIOS.map(p=>`<option value="${p.k}" ${p.k===Number(t.priority)?"selected":""}>${p.l}</option>`).join("")}</select></label>
      <label class="f">Статус<select id="t_status">${STATUSES.map(s=>`<option value="${s.k}" ${s.k===t.status?"selected":""}>${s.l}</option>`).join("")}</select></label>
    </div>
    ${isNew?"":`<div class="hist" id="hist" data-f="all">
      <div class="hhead"><h3>История на тикета (${(t.log||[]).length})</h3>${TABS}</div>
      <div class="addnote"><textarea id="t_note" placeholder="Добавете бележка: какво е направено, отговор на клиента…"></textarea>
      <div><button type="button" id="addNote">Добави бележка</button></div></div>
      <div class="tl">${(t.log||[]).slice().reverse().map(ev=>evHtml(ev)).join("")||`<div class="note">Още няма записи.</div>`}</div>
    </div>`}
  </form>
  <div class="df">${(!isNew&&(t.reporter===me.id||me.isAdmin))?`<button type="button" class="danger" id="delT">Изтрий</button>`:""}<div class="r"><button type="button" data-x>Отказ</button><button type="button" class="primary" id="saveT">${isNew?"Създай тикет":"Запази промените"}</button></div></div>`;
}
function openNew(preset){ui.openId=null;showDrawer(ticketForm(null,preset));bindForm(null)}
function openTicket(id){const t=tickets.find(x=>x.id===String(id));if(!t)return;ui.openId=t.id;showDrawer(ticketForm(t));bindForm(t)}
function bindForm(t){
  $("#saveT").onclick=()=>saveTicket(t);
  $("#tf").addEventListener("submit",e=>e.preventDefault());
  const fillSites=()=>{$("#t_sites").innerHTML=sitesOf($("#t_comp").value).map(s=>`<option value="${esc(s)}">`).join("")};
  fillSites();
  $("#t_comp").addEventListener("change",()=>{$("#t_cinfo").innerHTML=compInfo($("#t_comp").value);fillSites();const s=sitesOf($("#t_comp").value);if(s.length===1&&!$("#t_site").value)$("#t_site").value=s[0]});
  const fillCats=()=>{$("#t_cat").innerHTML=catOpts($("#t_dept").value,t&&t.department===$("#t_dept").value?t.category:"")};
  $("#t_dept").addEventListener("change",fillCats);
  const ta=$("#t_asg"); if(ta) ta.addEventListener("change",()=>{const u=user(ta.value.slice(2));if(u&&dept(u.department)&&$("#t_dept").value!==u.department){$("#t_dept").value=u.department;fillCats()}});
  const an=$("#addNote"); if(an) an.onclick=()=>addNote(t);
  const h=$("#hist"); if(h) tabsBind(h);
  const tk=$("#btnTake"); if(tk) tk.onclick=()=>transfer(t,"u:"+me.id,"");
  const tb=$("#btnTrf"); if(tb) tb.onclick=()=>{$("#trf").hidden=false;$("#trf_to").focus()};
  const tn=$("#trfNo"); if(tn) tn.onclick=()=>{$("#trf").hidden=true};
  const tg=$("#trfGo"); if(tg) tg.onclick=()=>{const v=$("#trf_to").value;if(v==="__"){toast("Изберете към кого да прехвърлите.");return}transfer(t,v,$("#trf_reason").value.trim())};
  const del=$("#delT"); if(del) del.onclick=()=>{
    if(del.dataset.sure){deleteTicket(t)} else {del.dataset.sure="1";del.textContent="Потвърди изтриване";setTimeout(()=>{if(del.isConnected){del.textContent="Изтрий";delete del.dataset.sure}},4000)}
  };
}
$("#btnNew").onclick=()=>openNew();

async function saveTicket(t){
  const body={id:t?t.id:"",title:$("#t_title").value.trim(),description:$("#t_desc").value.trim(),company:$("#t_comp").value,site:$("#t_site").value.trim(),
    department:$("#t_dept").value,category:$("#t_cat").value,priority:Number($("#t_prio").value),status:$("#t_status").value};
  if(!t){body.assignee=$("#t_asg").value.replace(/^u:/,"");body.reason=$("#t_reason").value.trim()}
  if(!body.title||!body.description){toast("Попълнете заглавие и описание на проблема.");return}
  const btn=$("#saveT");btn.disabled=true;
  try{const r=await api("tickets/save",body);closeDrawer();await refresh();
    toast(r.unchanged?"Няма промени за запазване.":(t?`Запазен ${tno(t.no)}`:`Създаден ${tno(r.id)}`+(body.assignee&&body.assignee!==me.id?` и насочен към ${uname(body.assignee)}`:"")))}
  catch(e){btn.disabled=false;toast(e.message)}
}
async function transfer(t,to,reason){
  try{await api("tickets/transfer",{id:t.id,to,reason});await refresh();openTicket(t.id);
    const id=to.slice(2);toast(to==="u:"+me.id?"Поехте тикета.":to.startsWith("u:")?`Прехвърлен на ${uname(id)}.`:to.startsWith("d:")?`Насочен към отдел ${dname(id)}.`:"Тикетът е свободен в отдела.")}
  catch(e){toast(e.message)}
}
async function addNote(t){
  const text=$("#t_note").value.trim(); if(!text){toast("Напишете бележката първо.");return}
  try{await api("tickets/note",{id:t.id,text});await refresh();openTicket(t.id);toast("Бележката е добавена")}catch(e){toast(e.message)}
}
async function deleteTicket(t){
  try{await api("tickets/delete",{id:t.id});closeDrawer();await refresh();toast(`Изтрит ${tno(t.no)}`)}catch(e){toast(e.message)}
}

/* ---------- history ---------- */
const EVC={create:"--accent",status:"--work",assign:"--wait",transfer:"--wait",take:"--wait",unassign:"--wait",prio:"--crit",edit:"--new",note:"--done"};
function evHtml(ev,withTicket){
  const ty=ev.type;
  const who=`${av(ev.by)}<b>${ev.by===me.id?"Аз":esc(uname(ev.by))}</b>`;
  const tk=withTicket?`<button type="button" class="tk" data-open="${esc(withTicket.id)}">${tno(withTicket.no)}</button>`:"";
  const person=id=>id?`<span class="who">${av(id)}${esc(uname(id))}</span>`:(ev.toDept?"отдел "+esc(ev.toDept):"свободен в отдела");
  const dmove=ev.toDept?`<div class="chg"><span class="note">Отдел:</span><span class="old">${esc(ev.fromDept)||"—"}</span> → <span>${esc(ev.toDept)}</span></div>`:"";
  const reason=ev.reason?`<div class="reason">„${esc(ev.reason)}“</div>`:"";
  let act="",body="";
  switch(ty){
    case"create":act="създаде тикета";break;
    case"take":act="пое тикета";body=(ev.from?`<div class="chg"><span class="old">${esc(uname(ev.from))}</span> → ${person(ev.to)}</div>`:"")+dmove;break;
    case"transfer":case"assign":act=ev.from?"прехвърли тикета":"насочи тикета";body=`<div class="chg">${ev.from?`<span class="who old">${esc(uname(ev.from))}</span> → `:""}${person(ev.to)}</div>${dmove}${reason}`;break;
    case"unassign":act=ev.toDept?"насочи тикета към отдел":"освободи тикета";body=`${ev.from?`<div class="chg"><span class="old">${esc(uname(ev.from))}</span> → ${ev.toDept?"отдел "+esc(ev.toDept):"свободен в отдела"}</div>`:""}${dmove}${reason}`;break;
    case"status":act="смени статуса";body=`<div class="chg">${pill(ev.from)} → ${pill(ev.to)}</div>`;break;
    case"prio":act="смени приоритета";body=`<div class="chg">${prio(ev.from)} → ${prio(ev.to)}</div>`;break;
    case"edit":act="редактира "+(ev.fields||[]).map(f=>f.l.toLowerCase()).join(", ");
      body=(ev.fields||[]).map(f=>f.f==="description"
        ?`<details><summary>Виж предишното описание</summary><div>${esc(f.from)||"(празно)"}</div></details>`
        :`<div class="chg"><span class="note">${esc(f.l)}:</span><span class="old">${esc(f.from)||"—"}</span> → <span>${esc(f.to)||"—"}</span></div>`).join("");break;
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
    <form class="sect" id="pwf"><h3>Смяна на парола</h3>
      <label class="f">Текуща парола<input id="pw_old" type="password" autocomplete="current-password"></label>
      <label class="f">Нова парола (поне 8 знака)<input id="pw_new" type="password" autocomplete="new-password"></label>
      <label class="f">Повторете новата парола<input id="pw_new2" type="password" autocomplete="new-password"></label>
      <div><button type="submit" class="primary">Смени паролата</button></div>
    </form>
  </div>
  <div class="df"><button type="button" class="danger" id="logoutBtn">Изход</button><div class="r"><button type="button" data-x>Затвори</button></div></div>`);
  $("#logoutBtn").onclick=async()=>{try{await api("logout",{})}catch(e){}location.href="/login?out=1"};
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
  box.innerHTML=users.map(u=>`<div class="mrow">${av(u.id)}<span class="nm">${esc(u.name)}${u.id===me.id?" (вие)":""}<br><span class="note">${esc(u.username)}${dname(u.department)?" · "+esc(dname(u.department)):""}</span> ${u.role==="admin"?`<span class="role">админ</span>`:""} ${u.active?"":`<span class="off">· неактивен</span>`}</span>
    ${me.isAdmin?`<button type="button" data-edit="${esc(u.id)}">Редактирай</button>`:""}</div>`).join("")
    +Array.from({length:Math.max(0,maxUsers-act)},()=>`<div class="mrow"><span class="av" style="background:var(--line)"></span><span class="nm slot">Свободно място</span>${me.isAdmin?`<button type="button" data-add="1">Добави</button>`:""}</div>`).join("");
}
$("#btnUsers").onclick=()=>{
  ui.openId=null;
  showDrawer(`<div class="dh"><h2>Екип (${team().length}/${maxUsers})</h2><button type="button" data-x aria-label="Затвори">✕</button></div>
  <div class="db"><div class="note">${me.isAdmin?"Като администратор добавяте колегите, задавате им парола и можете да деактивирате профил, за да освободите място.":"Потребителите се добавят от администратора."}</div>
  <div id="teamList"></div><div id="ufBox"></div></div>
  <div class="df"><div class="r"><button type="button" data-x>Затвори</button></div></div>`);
  drawTeam();
  $("#teamList").addEventListener("click",e=>{
    const ed=e.target.closest("[data-edit]"), ad=e.target.closest("[data-add]");
    if(!ed&&!ad)return;
    const u=ed?user(ed.dataset.edit):null;
    $("#ufBox").innerHTML=userForm(u);
    $("#ucancel").onclick=()=>$("#ufBox").innerHTML="";
    $("#u_name").focus();
    $("#uf").addEventListener("submit",async ev=>{ev.preventDefault();
      const body={id:u?u.id:"",name:$("#u_name").value.trim(),username:$("#u_user").value.trim(),password:$("#u_pass").value,role:$("#u_role").value,active:$("#u_active").checked,department:$("#u_dept").value};
      try{await api("users/save",body);await refresh();$("#ufBox").innerHTML="";drawTeam();$("#drawer h2").textContent=`Екип (${team().length}/${maxUsers})`;toast(u?"Потребителят е запазен.":"Потребителят е добавен.")}
      catch(err){toast(err.message)}});
  });
};

/* ---------- departments ---------- */
function deptForm(d){
  const isNew=!d; d=d||{id:"",name:"",categories:[]};
  return `<form class="sect" id="df"><h3>${isNew?"Нов отдел":"Редакция: "+esc(d.name)}</h3>
    <label class="f">Име на отдела<input id="d_name" maxlength="80" value="${esc(d.name)}" placeholder="Напр. Монтаж"></label>
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
    <div class="dtop"><div><b>${esc(d.name)}</b> <span class="note">· ${open.filter(t=>t.department===d.id).length} отворени · ${open.filter(t=>t.department===d.id&&!t.assignee).length} свободни</span></div>
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
      const body={id:d?d.id:"",name:$("#d_name").value.trim(),categories:$("#d_cats").value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean)};
      if(!body.name){toast("Въведете име на отдела.");return}
      try{await api("departments/save",body);await refresh();$("#dfBox").innerHTML="";drawDepts();toast(d?"Отделът е запазен.":"Отделът е създаден.")}catch(e){toast(e.message)}});
  };
  const a=$("#dAdd"); if(a) a.onclick=()=>edit(null);
  $("#deptList").addEventListener("click",e=>{const b=e.target.closest("[data-dedit]");if(b)edit(dept(b.dataset.dedit))});
};

/* ---------- start ---------- */
render();
refresh();
setInterval(()=>{if(document.visibilityState==="visible")refresh()},15000);
