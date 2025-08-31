(()=>{const c=document.getElementById("chat"),e=document.getElementById("msg"),
t=document.getElementById("typing"),s=document.getElementById("sources"),
d=document.getElementById("sid"),o=document.getElementById("clearBtn"),
a=document.getElementById("themeBtn"),n=Array.from(document.querySelectorAll(".tab")),
l=document.getElementById("composer");let r="chat",
i=(crypto.randomUUID&&crypto.randomUUID())||String(Math.random());

function p(t,n="bot"){const o=document.createElement("div");
o.className=`bubble ${n}`,
"bot"===n?o.innerHTML=`<div class="bot-avatar">🤖</div><div class="content"><div class="name">PiGenie</div><div>${h(t)}</div></div>`:
o.innerHTML=`<div class="content">${h(t)}</div>`,
c.appendChild(o),o.scrollIntoView({behavior:"smooth",block:"end"})}

function h(c){return(c||"").replace(/[&<>\"']/g,(c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c])))} 
function u(){e.style.height="1px",e.style.height=Math.min(160,e.scrollHeight)+"px"}
d.textContent=i,

n.forEach((c=>c.addEventListener("click",(()=>{n.forEach((c=>c.classList.remove("active"))),
c.classList.add("active"),r=c.dataset.mode,e.placeholder="rag"===r?
"Ask something I should look up on the web…":"akinator"===r?
"Say “start” or answer yes/no/unknown…":"Type your message…",
s.classList.add("hidden")})))),

e.addEventListener("input",u),u(),

l.addEventListener("submit",(async n=>{n.preventDefault();
const o=(e.value||"").trim();if(!o)return;
p(o,"me"),e.value="",u(),t.classList.remove("hidden"),
s.classList.add("hidden"),s.innerHTML="";try{
const e=await fetch("/api/chat",{method:"POST",
headers:{"Content-Type":"application/json"},
body:JSON.stringify({session_id:i,message:o,mode:r})}),
n=await e.json();i=n.session_id||i,d.textContent=i,
p(n.reply||"(no reply)","bot"),n.sources&&n.sources.length&&
(s.classList.remove("hidden"),s.innerHTML="Sources: "+
n.sources.map((c=>`\n<a class="source-link" href="${c.url}" target="_blank" rel="noopener">${h(c.title||c.url)}</a>`)).join(" | "))}catch(c){
p("Error: "+c,"bot")}finally{t.classList.add("hidden")}})),

o.addEventListener("click",(()=>{c.innerHTML="",s.classList.add("hidden"),
p("Chat cleared. How can I help?","bot")}));

let m=!0;a.addEventListener("click",(()=>{m=!m,
document.documentElement.style.filter=m?"none":"invert(1) hue-rotate(180deg)"}))})();
