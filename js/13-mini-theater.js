/* Independent fiction workspace. No chat generation, scheduler or memory writes. */
(() => {
'use strict';
const $ = id => document.getElementById('mt-' + id);
const uid = () => crypto.randomUUID();
const clone = x => JSON.parse(JSON.stringify(x));
const text = x => typeof x === 'string' ? x : '';
const defaults = { persona:true, user:true, history:true, memory:true, diary:false, roleWorld:false, globalWorld:false, time:false, previous:false, peek:false, moments:false };
const labels = {persona:'角色人设',user:'我的人设',history:'聊天记录',memory:'长期记忆',diary:'回忆日记',roleWorld:'角色绑定世界书',globalWorld:'其他世界书（手动选择）',time:'当前现实时间',previous:'之前的小剧场',peek:'偷看手机数据',moments:'动态内容'};
const apiDefaults = {source:'role', maxTokens:16384, stream:true, sampling:true, reasoning:''};
const draftDefaults = () => ({ instruction:'', preset:'', context:{...defaults}, count:'100', worldExcluded:[], globalIds:[], font:18,line:1.9,paragraph:12 });
const table = () => dexieDB.theaterRecords;
const char = id => db.characters.find(c => c.id === id);
const draftId = id => 'draft:'+id;
const tasks = new Map();
let pinnedRoles=[], roleId='', draft=draftDefaults(), work=null, presets=[], settings={...apiDefaults}, editor=null, viewEpoch=0, draftTimer=null, apiReturn=false;
let savedInstructions = [], pendingInstructionId = '';
const visible = () => $('main').closest('.screen').classList.contains('active');
function el(tag, value, attrs={}) { const e=document.createElement(tag); if(value!=null)e.textContent=value; Object.assign(e,attrs); return e; }
function option(value,label) { return el('option',label,{value}); }
function button(label,fn) { const b=el('button',label,{type:'button',className:'btn'}); b.addEventListener('click',()=>run(fn)); return b; }
function run(fn) { Promise.resolve().then(fn).catch(e=>{console.warn('[Theater]',e);showToast(e.message||'小剧场操作失败');}); }
function status(msg) { $('status').textContent=msg; }
function name(c) { return c.realName || c.name || c.id; }
function displayName(c) { return c.remarkName || name(c); }
function owned(id,record) { return record?.kind==='work' && record.characterId===id; }
async function putOwned(record) { // Check existence atomically with write; no recreation after deleting a role.
 return dexieDB.transaction('rw',dexieDB.characters,table(),async()=>{
  if(!await dexieDB.characters.get(record.characterId)) throw new Error('角色已删除，未保存小剧场');
  await table().put(record);
 });
}
async function saveDraft(id=roleId, data=draft) { if(id && char(id)) await putOwned({id:draftId(id),kind:'draft',characterId:id,data:clone(data),updatedAt:Date.now()}); }
function scheduleDraft() { const id=roleId, data=clone(draft); clearTimeout(draftTimer); draftTimer=setTimeout(()=>run(()=>saveDraft(id,data)),250); }
function readDraft() { if(!roleId)return; draft.instruction=$('instruction').value; draft.preset=$('preset').value; draft.count=$('history-count').value; draft.font=+$('font').value;draft.line=+$('line').value;draft.paragraph=+$('paragraph').value; }
async function flush() {clearTimeout(draftTimer);readDraft();await saveDraft();}
async function loadGlobals() { const rows=await table().where('kind').equals('preset').toArray();presets=rows.filter(p=>!p.characterId);settings={...apiDefaults,...(await table().get('settings'))?.data}; }
function fillPresets() { $('preset').replaceChildren(option('','无预设 · 直接创作'),...presets.map(p=>option(p.id,p.name))); $('preset').value=presets.some(p=>p.id===draft.preset)?draft.preset:''; }
function selectedInstruction() {
 return savedInstructions.find(row => row.id === $('saved-instruction').value);
}
function updateInstructionControls() {
 const row = selectedInstruction();
 $('instruction-name').value = row?.name || '';
 $('update-instruction').disabled = !row;
 $('delete-instruction').disabled = !row;
}
async function refreshInstructions(id = $('saved-instruction').value) {
 savedInstructions = await table().where('kind').equals('instruction').toArray();
 savedInstructions.sort((a, b) => b.updatedAt - a.updatedAt);
 $('saved-instruction').replaceChildren(
  option('', savedInstructions.length ? '请选择指令' : '暂无已保存的指令'),
  ...savedInstructions.map(row => option(row.id, row.name))
 );
 $('saved-instruction').value = savedInstructions.some(row => row.id === id) ? id : '';
 updateInstructionControls();
}
function applyInstruction(row) {
 $('instruction').value = row.instruction;
 readDraft();
 scheduleDraft();
}
function chooseInstruction() {
 const row = selectedInstruction();
 updateInstructionControls();
 pendingInstructionId = '';
 if (!row) return;
 if ($('role-panel').hidden) pendingInstructionId = row.id;
 else applyInstruction(row);
}
async function storeInstruction(update = false) {
 const existing = selectedInstruction();
 if (update && !existing) return;
 const id = update ? existing.id : 'instruction:' + uid();
 const name = $('instruction-name').value.trim();
 const instruction = $('instruction').value.trim();
 if (!name || !instruction) throw new Error('请填写指令名称和创作指令');
 const epoch = viewEpoch;
 const fields = { name, instruction, updatedAt: Date.now() };
 if (update) {
  const changed = await table().update(id, fields);
  if (!changed) {
   await refreshInstructions();
   throw new Error('这条指令已删除');
  }
 } else {
  await table().add({ id, kind: 'instruction', ...fields });
 }
 await refreshInstructions(epoch === viewEpoch ? id : $('saved-instruction').value);
 showToast(update ? '指令已更新' : '指令已保存');
}
async function deleteInstruction() {
 const row = selectedInstruction();
 if (!row || !confirm('删除选中的已保存指令？')) return;
 await table().delete(row.id);
 await refreshInstructions();
 showToast('已删除保存的指令');
}
function refreshWorlds() { const c=char(roleId), out=$('world-entries');out.replaceChildren(); if(!c)return;const ids=new Set(c.worldBookIds||[]);for(const b of db.worldBooks||[]) {if(b.type==='folder'||typeof b.content!=='string'||b.activation==='off')continue;const bound=ids.has(b.id);if(bound?!draft.context.roleWorld:!draft.context.globalWorld)continue; const l=el('label');const ck=el('input',null,{type:'checkbox',checked:bound?!draft.worldExcluded.includes(b.id):draft.globalIds.includes(b.id)});ck.onchange=()=>{const k=bound?'worldExcluded':'globalIds';const set=new Set(draft[k]);if(bound?!ck.checked:ck.checked)set.add(b.id);else set.delete(b.id);draft[k]=[...set];scheduleDraft();};l.append(ck,document.createTextNode(' '+(b.name||b.title||b.id)));out.append(l);} }
function showDraft() { fillPresets();$('instruction').value=draft.instruction;$('history-count').value=draft.count;$('font').value=draft.font;$('line').value=draft.line;$('paragraph').value=draft.paragraph; const out=$('context');out.replaceChildren();for(const [k,label] of Object.entries(labels)){const l=el('label');const ck=el('input',null,{type:'checkbox',checked:!!draft.context[k]});ck.onchange=()=>{draft.context[k]=ck.checked;refreshWorlds();scheduleDraft();};l.append(ck,document.createTextNode(' '+label));out.append(l);}refreshWorlds();reading(); }
function reading(){const body=$('body');body.style.fontSize=$('font').value+'px';body.style.lineHeight=$('line').value;body.style.setProperty('--mt-paragraph',$('paragraph').value+'px');}
function drawBody(body){$('body').replaceChildren(...text(body).split(/\n\s*\n/).map(p=>el('p',p)));}
function showWork(record) {work=record; $('reader').hidden=!record;$('edit-body').hidden=true;$('body').hidden=false;$('edit').textContent='编辑正文';$('followup').value=''; if(record){$('title').value=record.title;$('favorite').textContent=record.favorite?'取消收藏':'收藏';drawBody(record.body);}else drawBody('');updateButtons();}
function updateButtons(){const busy=tasks.has(roleId);$('generate').disabled=busy;$('stop').disabled=!busy;for(const id of ['regenerate','continue','rewrite','edit','delete','favorite','title'])$(id).disabled=busy||!work;}
async function refreshLibrary(){const id=roleId,epoch=viewEpoch;if(!id)return;const rows=await table().where('[characterId+kind]').equals([id,'work']).toArray();if(epoch!==viewEpoch||id!==roleId)return;const out=$('works');out.replaceChildren();for(const w of rows.sort((a,b)=>b.updatedAt-a.updatedAt)){if($('favorites').checked&&!w.favorite)continue;const b=button((w.favorite?'★ ':'')+w.title,()=>{if(roleId===id&&!tasks.has(id)){showWork(w);status(w.status==='running'?'上次生成中断，已保留正文':w.status==='partial'?'未完成正文':'');}});b.style.width='100%';const box=el('div',null,{className:'mt-card'});box.append(b,el('small',new Date(w.updatedAt).toLocaleString()+' · '+text(w.body).length+' 字'));out.append(box);}if(!out.childElementCount)out.append(el('small','暂无作品'));}
async function selectRole(id) {
 const epoch = ++viewEpoch;
 $('role-panel').hidden = true;
 await flush();
 if (epoch !== viewEpoch) return;
 if (!char(id)) {
  roleId = '';
  work = null;
  return;
 }
 const row = await table().get(draftId(id));
 if (epoch !== viewEpoch) return;
 roleId = id;
 work = null;
 const saved = row?.data || {};
 draft = {...draftDefaults(), ...saved, context:{...defaults, ...saved.context}};
 showDraft();
 const instruction = savedInstructions.find(item => item.id === pendingInstructionId);
 pendingInstructionId = '';
 $('saved-instruction').value = instruction?.id || '';
 updateInstructionControls();
 if (instruction) applyInstruction(instruction);
 const task = tasks.get(id);
 showWork(task?.record || null);
 status(task ? '正在生成…' : '');
 $('role-panel').hidden = false;
 await refreshLibrary();
}
function normalizePins(values,choices){const valid=new Set(choices.map(c=>c.id));return [...new Set(Array.isArray(values)?values:[])].filter(id=>valid.has(id));}
function sortRoles(choices,pins){const map=new Map(choices.map(c=>[c.id,c]));const ordered=normalizePins(pins,choices);const set=new Set(ordered);return [ordered.map(id=>map.get(id)),choices.filter(c=>!set.has(c.id))];}
function renderRoles(selected=$('role').value){const choices=db.characters||[];const [top,rest]=sortRoles(choices,pinnedRoles);const select=$('role');select.replaceChildren(option('','请选择角色'));for(const [label,items] of [['置顶角色',top],['其他角色',rest]]){if(!items.length)continue;const group=el('optgroup',null,{label});group.append(...items.map(c=>option(c.id,displayName(c))));select.append(group);}select.value=choices.some(c=>c.id===selected)?selected:'';const list=$('pin-list');list.replaceChildren();for(const c of [...top,...rest]){const pinned=pinnedRoles.includes(c.id);const row=el('div',null,{className:'mt-pin-row'});const title=el('span',displayName(c));const b=button(pinned?'取消置顶':'置顶',()=>togglePin(c.id));b.setAttribute('aria-pressed',String(pinned));b.setAttribute('aria-label',(pinned?'取消置顶 ':'置顶 ')+displayName(c));row.append(title,b);list.append(row);}if(!choices.length)list.append(el('small','暂无角色'));$('pin-summary').textContent='管理置顶角色'+(top.length?'（'+top.length+'）':'');}
async function togglePin(id){if(!char(id))return;let next;await dexieDB.transaction('rw',table(),async()=>{const current=normalizePins((await table().get('role-pins'))?.data?.ids,db.characters||[]);next=current.includes(id)?current.filter(x=>x!==id):[...current,id];await table().put({id:'role-pins',kind:'settings',data:{ids:next},updatedAt:Date.now()});});pinnedRoles=next;renderRoles();}
async function open(){await Promise.all([loadGlobals(),refreshInstructions()]);const old=roleId;const choices=db.characters||[];pinnedRoles=normalizePins((await table().get('role-pins'))?.data?.ids,choices);renderRoles(choices.some(c=>c.id===old)?old:choices.length===1?choices[0].id:'');switchScreen('mini-theater-screen');if(roleId===$('role').value&&roleId){fillPresets();refreshWorlds();await refreshLibrary();updateButtons();}else await selectRole($('role').value);}
// SillyTavern presets: preserve original JSON without executing extensions or scripts.
const markerKeys = { charDescription:'persona',charPersonality:'persona',scenario:'persona',personaDescription:'user',chatHistory:'history',worldInfoBefore:'world',worldInfoAfter:'world',dialogueExamples:'examples' };
const allowedRoles=new Set(['system','user','assistant']);
function parsePreset(raw, filename='创作预设') {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('预设 JSON 格式无效');
 if(!Array.isArray(raw.prompts))throw new Error('仅支持包含 prompts 的酒馆 Chat Completion JSON');
 const warnings=[];const prompts=raw.prompts.filter(p=>p&&typeof p.identifier==='string');
 const orders=Array.isArray(raw.prompt_order)?raw.prompt_order:[];const group=orders.find(x=>x?.character_id===100001)||orders.find(x=>x?.character_id===100000)||orders.find(x=>Array.isArray(x?.order));
 if(orders.length>1)warnings.push('多个 prompt_order 配置：采用全局/首个有效顺序，可在编辑器调整。');
 const used=new Set();const rows=[];
 const add=(p,order)=>{if(!p||used.has(p.identifier))return;used.add(p.identifier);const marker=markerKeys[p.identifier]||'';if(p.marker&&!marker)warnings.push('未支持的 marker：'+p.identifier);if(p.injection_position===1)warnings.push('深度注入条目：'+(p.name||p.identifier)+'，按历史深度近似插入。');rows.push({identifier:p.identifier,name:text(p.name)||p.identifier,content:text(p.content),role:allowedRoles.has(p.role)?p.role:'system',enabled:order?.enabled??p.enabled??true,marker,depth:p.injection_position===1?Math.max(0,Math.trunc(+p.injection_depth||0)):null});};
 if(group)for(const item of group.order||[]){const p=prompts.find(p=>p.identifier===item.identifier);if(p)add(p,item);else warnings.push('顺序引用缺失条目：'+item.identifier);}
 for(const p of prompts)if(!used.has(p.identifier))add(p,group?{enabled:false}:null);
 if(!rows.length)throw new Error('预设没有可导入条目');
 if(rows.some(r=>/\{\{(?!char\s*\}\}|user\s*\}\}|charIfNotGroup\s*\}\}|description\s*\}\}|personality\s*\}\}|scenario\s*\}\}|persona\s*\}\})[^}]+\}\}/i.test(r.content)))warnings.push('含未识别宏，原样保留；不运行 STscript 或扩展。');
 if(raw.extensions||raw.regex_scripts)warnings.push('扩展及正则脚本仅保留在原始 JSON，不运行。');
 return {id:'preset:'+uid(),kind:'preset',name:text(raw.name)||filename.replace(/\.json$/i,''),rows,raw:clone(raw),warnings,temperature:Number.isFinite(raw.temperature)?raw.temperature:null,topP:Number.isFinite(raw.top_p)?raw.top_p:null,updatedAt:Date.now()};
}
function renderPresets(){const root=$('preset-list');root.replaceChildren();for(const p of presets){const card=el('div',null,{className:'mt-card'});card.append(el('strong',p.name),el('small',p.rows.filter(r=>r.enabled).length+' / '+p.rows.length+' 条开启'));const a=el('div',null,{className:'mt-actions'});a.append(button('编辑',()=>{editor=clone(p);renderEditor();}),button('导出 JSON',()=>download(p.name+'.json',JSON.stringify(exportPreset(p),null,2),'application/json')),button('删除',async()=>{if(!confirm('删除此创作预设？已生成作品仍保留。'))return;await table().delete(p.id);await loadGlobals();renderPresets();fillPresets();}));card.append(a);root.append(card);}if(!presets.length)root.append(el('small','尚未导入创作预设'));}
function exportPreset(p){const raw=clone(p.raw||{});raw.name=p.name;raw.prompts=p.rows.map(r=>({...((raw.prompts||[]).find(x=>x.identifier===r.identifier)||{}),identifier:r.identifier,name:r.name,role:r.role,content:r.content,enabled:r.enabled,marker:!!r.marker,injection_position:r.depth===null?0:1,injection_depth:r.depth??4}));raw.prompt_order=[{character_id:100001,order:p.rows.map(r=>({identifier:r.identifier,enabled:r.enabled}))},...(raw.prompt_order||[]).filter(g=>g.character_id!==100001)];return raw;}
function renderEditor(){const root=$('preset-editor');root.hidden=!editor;root.replaceChildren();if(!editor)return;const input=el('input',null,{value:editor.name});input.oninput=()=>editor.name=input.value;root.append(input);if(editor.warnings?.length)root.append(el('small',editor.warnings.join('\n')));editor.rows.forEach((r,i)=>{const card=el('div',null,{className:'mt-card'});const ck=el('input',null,{type:'checkbox',checked:r.enabled});ck.onchange=()=>r.enabled=ck.checked;const label=el('label');label.append(ck,document.createTextNode(' '+r.name));const title=el('input',null,{value:r.name});title.oninput=()=>r.name=title.value;const role=el('select');role.append(...[...allowedRoles].map(v=>option(v,v)));role.value=r.role;role.onchange=()=>r.role=role.value;const content=el('textarea',null,{value:r.content,placeholder:r.marker?'资料插槽：'+r.marker:'提示词正文'});content.oninput=()=>r.content=content.value;const a=el('div',null,{className:'mt-actions'});for(const [label,delta] of [['上移',-1],['下移',1]]){const b=button(label,()=>{const j=i+delta;if(j<0||j>=editor.rows.length)return;[editor.rows[i],editor.rows[j]]=[editor.rows[j],editor.rows[i]];renderEditor();});b.disabled=i+delta<0||i+delta>=editor.rows.length;a.append(b);}a.append(button('移除',()=>{editor.rows.splice(i,1);renderEditor();}));card.append(label,title,role,content,a);root.append(card);});const a=el('div',null,{className:'mt-actions'});a.append(button('新增条目',()=>{editor.rows.push({identifier:'custom-'+uid(),name:'新条目',content:'',role:'system',enabled:true,marker:'',depth:null});renderEditor();}),button('保存预设',async()=>{if(!editor.name.trim())throw new Error('请填写预设名称');editor.updatedAt=Date.now();await table().put(clone(editor));editor=null;renderEditor();await loadGlobals();renderPresets();fillPresets();showToast('小剧场预设已保存');}),button('取消',()=>{editor=null;renderEditor();}));root.append(a);}
async function refreshSettings(){try{await loadGlobals();const s=$('api-source');s.replaceChildren(option('role','跟随当前角色 API'),option('secondary','副 API（独立选择）'),...(db.apiPresets||[]).map(p=>option('preset:'+(p.id||p.name),p.name)));s.value=settings.source;if(!s.value){s.append(option(settings.source,'已失效的 API 预设（请重新选择）'));s.value=settings.source;}$('max-tokens').value=settings.maxTokens;$('stream').checked=settings.stream;$('use-sampling').checked=settings.sampling;$('reasoning').value=settings.reasoning;renderPresets();}catch(e){console.warn(e);}}
function resolveApi(c,s){let a={...resolveChatApiConfig(c)};if(s.source==='secondary'){const secondary=db.apiSettings.secondary;if(!secondary?.enabled)throw new Error('副 API 未启用，请先配置');a={...a,...secondary};}else if(s.source.startsWith('preset:')){const id=s.source.slice(7);const p=(db.apiPresets||[]).find(x=>(x.id||x.name)===id);if(!p?.data)throw new Error('小剧场 API 预设不存在');a={...a,url:p.data.apiUrl,key:p.data.apiKey,model:p.data.model,provider:p.data.provider||'newapi',temperatureEnabled:p.data.temperatureEnabled,temperature:p.data.temperature};}if(!a.url||!a.model)throw new Error('请先配置小剧场使用的 API 地址和模型');return a;}
// Only explicit, textual fields are serialized. Never send avatars, keys, hidden reasoning or other roles.
function compact(value,limit=60000){return JSON.stringify(value,(k,v)=>/^(avatar|image|imageUrl|dataUrl|base64|apiKey|key|token|password|secret|reasoning|thinking)$/i.test(k)?undefined:typeof v==='string'&&/^data:/i.test(v)?undefined:v).slice(0,limit);}
function historyMessages(c,d){const rows=(c.history||[]).filter(m=>['user','assistant'].includes(m.role)&&!m.isContextDisabled&&!m.isWithdrawn&&!m.isThinking&&!m.isStatusUpdate&&typeof m.content==='string'&&!/^data:/i.test(m.content));return (d.count==='all'?rows:rows.slice(-Math.max(1,+d.count||100))).map(m=>({role:m.role,content:m.content}));}
async function contextFor(c,d){const x=d.context;const history=x.history?historyMessages(c,d):[];const ids=new Set(c.worldBookIds||[]);const worlds=(db.worldBooks||[]).filter(w=>w.type!=='folder'&&w.activation!=='off'&&typeof w.content==='string'&&(ids.has(w.id)?x.roleWorld&&!d.worldExcluded.includes(w.id):x.globalWorld&&d.globalIds.includes(w.id)));const mem=x.memory?await memoryRepository.listForArchive(c.id,c.activeArchiveId):[];const old=x.previous?(await table().where('[characterId+kind]').equals([c.id,'work']).toArray()).sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,5):[];
 return {persona:x.persona?`角色：${name(c)}\n${text(c.persona)}`:'',user:x.user?`用户：${text(c.myName)}\n${text(c.myPersona)}`:'',history,world:worlds.map(w=>w.content).join('\n\n'),examples:'',extra:[x.memory&&mem.length?['长期记忆',mem.filter(m=>m.enabled!==false&&(!m.expiresAt||m.expiresAt>Date.now())).map(m=>[m.title,m.summary,m.details,m.meaning].filter(Boolean).join('\n')).join('\n\n')]:null,x.diary?['回忆日记',compact((c.memoryJournals||[]).map(j=>({title:j.title,content:j.content})))]:null,x.time?['当前时间',new Date().toLocaleString()]:null,x.peek?['偷看手机资料',compact(c.peekData||{})]:null,x.moments?['角色动态',compact(c.moments||[])]:null,x.previous?['此前小剧场（非正史）',old.map(w=>w.title+'\n'+w.body).join('\n\n')]:null].filter(Boolean).map(([k,v])=>`${k}：\n${v}`).join('\n\n')};}
function assemble(c,d,p,ctx,instruction,previous='',mode='new'){
 const values={char:name(c),charifnotgroup:name(c),user:text(c.myName)||'用户',description:d.context.persona?text(c.persona):'',personality:d.context.persona?text(c.persona):'',scenario:d.context.persona?text(c.scenario):'',persona:d.context.user?text(c.myPersona):''};const expand=s=>text(s).replace(/\{\{\s*(\w+)\s*\}\}/g,(m,k)=>Object.hasOwn(values,k.toLowerCase())?values[k.toLowerCase()]:m);
 const messages=[],used=new Set(),depth=[];const add=(role,content)=>{if(text(content).trim())messages.push({role,content});};const slot=k=>{if(used.has(k))return;used.add(k);if(k==='history'){const hist=ctx.history;for(let i=0;i<=hist.length;i++){for(const row of depth.filter(r=>Math.max(0,hist.length-r.depth)===i))add(row.role,expand(row.content));if(i<hist.length)add(hist[i].role,hist[i].content);}}else add('system',ctx[k]);};
 for(const r of p?.rows||[])if(r.enabled&&r.depth!==null&&Number.isFinite(r.depth)&&!r.marker)depth.push(r);
 for(const r of p?.rows||[]){if(!r.enabled)continue;if(r.marker)slot(r.marker);else if(r.depth===null||!Number.isFinite(r.depth))add(r.role,expand(r.content));}
 for(const k of ['persona','user','world','history'])slot(k);add('system',ctx.extra);if(previous)add('assistant',previous);add('user',mode==='continue'?'续写当前作品。'+instruction:mode==='rewrite'?'改写当前作品。'+instruction:instruction);return messages;
}
function extract(data,provider){if(data.error)throw new Error(text(data.error.message)||'API 返回错误');if(provider==='gemini')return (data.candidates?.[0]?.content?.parts||[]).filter(p=>!p.thought).map(p=>text(p.text)).join('');return text(data.choices?.[0]?.delta?.content)||text(data.choices?.[0]?.message?.content);}
async function request(a,m,s,p,onChunk,signal){const opts={};if(s.sampling&&p){if(Number.isFinite(p.temperature))opts.temperature=p.temperature;if(Number.isFinite(p.topP))opts.topP=p.topP;}if(opts.temperature===undefined&&a.temperatureEnabled&&Number.isFinite(a.temperature))opts.temperature=a.temperature;let {endpoint,headers,requestBody}=buildChatApiRequest(a,m,opts);if(a.provider==='gemini'){requestBody.generationConfig={...requestBody.generationConfig,maxOutputTokens:s.maxTokens};if(s.stream)endpoint=endpoint.replace(':generateContent',':streamGenerateContent')+'&alt=sse';}else {requestBody.max_tokens=s.maxTokens;requestBody.stream=!!s.stream;if(s.reasoning)requestBody.reasoning_effort=s.reasoning;}const r=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(requestBody),signal});if(!r.ok)throw new Error('API 请求失败（HTTP '+r.status+'）');const type=r.headers.get('content-type')||'';if(!type.includes('text/event-stream')&&!s.stream){const data=await r.json();onChunk(extract(data,a.provider));return;}if(type.includes('application/json')){const data=await r.json();for(const item of Array.isArray(data)?data:[data])onChunk(extract(item,a.provider));return;}if(!r.body)throw new Error('API 没有返回响应体');const reader=r.body.getReader(),decoder=new TextDecoder();let buffer='',event=[],doneFlag=false;const eventEnd=()=>{if(!event.length)return;const v=event.join('\n');event=[];if(v==='[DONE]'){doneFlag=true;return;}onChunk(extract(JSON.parse(v),a.provider));};const line=l=>{if(!l.trim()){eventEnd();return;}if(l.startsWith('data:'))event.push(l.slice(5).trimStart());};try{while(!doneFlag){const {value,done}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});let i;while((i=buffer.indexOf('\n'))>=0){line(buffer.slice(0,i).replace(/\r$/,''));buffer=buffer.slice(i+1);}if(done){if(buffer)line(buffer);eventEnd();break;}}}finally{try{await reader.cancel();}catch{}}}
async function generate(mode='new'){
 const id=roleId,c=char(id);if(!c||tasks.has(id))return;readDraft();const d=clone(draft),prior=work&&clone(work);const instruction=mode==='new'?d.instruction.trim():mode==='regenerate'?prior?.instruction:$('followup').value.trim();if(!instruction&&mode!=='continue')throw new Error('请输入创作指令');if(mode!=='new'&&!owned(id,prior))throw new Error('请先选择作品');
 const record={id:'work:'+uid(),kind:'work',characterId:id,title:mode==='new'?instruction.slice(0,32):prior.title+(mode==='continue'?' · 续篇':mode==='rewrite'?' · 改写':' · 重生成'),instruction:mode==='regenerate'?prior.instruction:instruction,body:mode==='continue'?prior.body+'\n\n':'',favorite:false,status:'running',updatedAt:Date.now(),parentId:prior?.id||null};
 const task={record,controller:new AbortController()};tasks.set(id,task);showWork(record);status('正在准备上下文…');updateButtons();let token,saveChain=Promise.resolve(),lastSaved=0,lastPaint=0;const persist=()=>{const snapshot=clone(record);saveChain=saveChain.catch(()=>{}).then(()=>putOwned(snapshot));return saveChain;};
 try{await saveDraft(id,d);await loadGlobals();const s=clone(settings),p=presets.find(p=>p.id===d.preset);if(d.preset&&!p)throw new Error('所选预设已删除');const a=resolveApi(c,s);const ctx=await contextFor(c,d);const m=assemble(c,d,p,ctx,instruction||'',mode==='continue'||mode==='rewrite'?prior.body:'',mode);await persist();if(task.controller.signal.aborted)throw new DOMException('Stopped','AbortError');if(window.MouxiAndroid?.beginManualGeneration){const t='theater-'+uid();if(window.MouxiAndroid.beginManualGeneration(t))token=t;}let received=false;const render=()=>{if(roleId===id&&work?.id===record.id&&visible()){drawBody(record.body);status('正在生成 · '+record.body.length+' 字');}};await request(a,m,s,p,chunk=>{if(!chunk)return;received=true;record.body+=chunk;record.updatedAt=Date.now();const now=Date.now();if(now-lastPaint>90){lastPaint=now;render();}if(now-lastSaved>1500){lastSaved=now;persist().catch(e=>{task.storageError=e;task.controller.abort();});}},task.controller.signal);if(!received)throw new Error('模型未返回正文');record.status='complete';}
 catch(e){record.status='partial';record.error=task.storageError?'保存失败：'+task.storageError.message:task.controller.signal.aborted?'已停止生成':e.message;if(roleId===id&&work?.id===record.id)status(record.error);}
 finally{if(token)try{window.MouxiAndroid.endManualGeneration(token);}catch{}record.updatedAt=Date.now();try{await persist();}catch(e){record.error='保存失败：'+e.message;}tasks.delete(id);if(roleId===id&&work?.id===record.id){drawBody(record.body);status(record.error||'生成完成 · '+record.body.length+' 字');updateButtons();await refreshLibrary();}}
}
async function updateWork(patch){if(!work||tasks.has(roleId))return;const id=roleId,record={...work,...patch,updatedAt:Date.now()};if(!owned(id,record))return;await putOwned(record);if(roleId===id&&work?.id===record.id){work=record;await refreshLibrary();}}
function download(name,body,mime){const blob=new Blob([body],{type:mime});const url=URL.createObjectURL(blob);const a=el('a',null,{href:url,download:name.replace(/[\\/:*?"<>|]/g,'_')});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function bind(){const on=(id,fn,event='click')=>$(id).addEventListener(event,()=>run(fn));on('role',()=>selectRole($('role').value),'change');for(const id of ['instruction','preset','history-count','font','line','paragraph'])on(id,()=>{readDraft();reading();scheduleDraft();},id==='instruction'||['font','line','paragraph'].includes(id)?'input':'change');on('open-settings',async()=>{await flush();apiReturn=true;switchScreen('api-settings-screen');document.getElementById('api-theater-settings').open=true;document.getElementById('api-theater-settings').scrollIntoView();});on('save-api',async()=>{const max=Number($('max-tokens').value);if(!Number.isInteger(max)||max<1||max>262144)throw new Error('最大 Token 必须在 1–262144 之间');settings={source:$('api-source').value,maxTokens:max,stream:$('stream').checked,sampling:$('use-sampling').checked,reasoning:$('reasoning').value};await table().put({id:'settings',kind:'settings',data:settings,updatedAt:Date.now()});showToast('小剧场 API 配置已保存');});on('import-preset',()=>$('preset-file').click());on('preset-file',async()=>{const f=$('preset-file').files[0];$('preset-file').value='';if(!f)return;if(f.size>10*1024*1024)throw new Error('预设文件超过 10 MB');editor=parsePreset(JSON.parse(await f.text()),f.name);renderEditor();},'change');on('new-preset',()=>{editor={id:'preset:'+uid(),kind:'preset',name:'自定义创作预设',rows:[{identifier:'custom-'+uid(),name:'创作要求',role:'system',enabled:true,content:'',marker:'',depth:null}],warnings:[],updatedAt:Date.now()};renderEditor();});on('generate',()=>generate());on('regenerate',()=>generate('regenerate'));on('continue',()=>generate('continue'));on('rewrite',()=>generate('rewrite'));on('stop',()=>tasks.get(roleId)?.controller.abort());on('favorites',refreshLibrary,'change');on('title',()=>updateWork({title:$('title').value.trim()||'未命名作品'}),'change');on('favorite',async()=>{await updateWork({favorite:!work.favorite});$('favorite').textContent=work?.favorite?'取消收藏':'收藏';});on('edit',async()=>{if(!work)return;if($('edit-body').hidden){$('edit-body').value=work.body;$('edit-body').hidden=false;$('body').hidden=true;$('edit').textContent='保存正文';}else{await updateWork({body:$('edit-body').value});showWork(work);}});on('copy',async()=>{if(!work)return;await navigator.clipboard.writeText(work.body);showToast('已复制全文');});on('txt',()=>work&&download(work.title+'.txt',work.body,'text/plain;charset=utf-8'));on('md',()=>work&&download(work.title+'.md','# '+work.title+'\n\n'+work.body,'text/markdown;charset=utf-8'));on('delete',async()=>{if(!work||tasks.has(roleId)||!confirm('删除这篇作品？'))return;await table().delete(work.id);showWork(null);await refreshLibrary();});
 // Existing back button returns from API to the theater when entered there.
 document.addEventListener('click',e=>{if(apiReturn&&e.target.closest('#api-settings-screen .back-btn')){apiReturn=false;e.stopImmediatePropagation();e.preventDefault();run(open);}},true);
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&roleId)run(flush);});
 on('saved-instruction', chooseInstruction, 'change');
 on('save-instruction', () => storeInstruction());
 on('update-instruction', () => storeInstruction(true));
 on('delete-instruction', deleteInstruction);
}
function validateBackup(rows, ids) {
 if (!Array.isArray(rows)) throw new Error('小剧场备份无效');
 const seen = new Set();
 return rows.filter(row => {
  if (!row || typeof row.id !== 'string' || seen.has(row.id) ||
      !['work', 'draft', 'settings', 'preset', 'instruction'].includes(row.kind)) {
   throw new Error('小剧场备份记录无效');
  }
  seen.add(row.id);
  if (row.kind === 'work' || row.kind === 'draft') {
   if (!ids.has(row.characterId)) return false;
   if (row.kind === 'work' && (typeof row.body !== 'string' || typeof row.title !== 'string')) {
    throw new Error('小剧场作品格式无效');
   }
   if (row.kind === 'draft' && (!row.data || row.id !== draftId(row.characterId))) {
    throw new Error('小剧场草稿格式无效');
   }
  } else if (row.characterId) {
   throw new Error('小剧场全局配置无效');
  }
  if (row.kind === 'preset' && (!Array.isArray(row.rows) || typeof row.name !== 'string')) {
   throw new Error('小剧场预设格式无效');
  }
  if (row.kind === 'instruction' && (!row.id.startsWith('instruction:') ||
      !text(row.name).trim() || !text(row.instruction).trim())) {
   throw new Error('小剧场创作指令格式无效');
  }
  return true;
 });
}
async function prune(){const ids=new Set(await dexieDB.characters.toCollection().primaryKeys());await table().filter(r=>r.characterId&&!ids.has(r.characterId)).delete();await dexieDB.transaction('rw',table(),async()=>{const r=await table().get('role-pins');if(r){const saved=Array.isArray(r.data?.ids)?r.data.ids:[];const kept=[...new Set(saved)].filter(id=>ids.has(id));if(kept.length!==saved.length)await table().put({...r,data:{ids:kept},updatedAt:Date.now()});}});}
window.MiniTheater={open:()=>run(open),refreshSettings,validateBackup,prune};
if(typeof module!=='undefined')module.exports={parsePreset,assemble,extract,normalizePins,sortRoles};
if(typeof document!=='undefined')bind();
})();
