'use strict';
const hourMs=3600000;
const pauseReasons=new Map(Object.entries({
  "100": "Pausa 10",
  "101": "Almoco",
  "102": "Lanche",
  "103": "Saida Particular",
  "104": "Banheiro",
  "105": "Atendimento Recepcao",
  "106": "Feedback",
  "107": "Treinamento",
  "108": "Livre",
  "109": "Conferencia",
  "110": "Pausa 20",
  "111": "CST_LANCHE",
  "112": "CST_DESCANSO",
  "113": "Laboral",
  "114": "NR17",
  "115": "Reuniao",
  "116": "Proposta",
  "117": "Retorno"
}));
function pauseReasonLabel(reason){
  if(!reason||reason==='0')return 'Sem motivo informado';
  if(/^\d+$/.test(reason))return pauseReasons.get(reason)||'Descrição indisponível';
  return reason;
}
const occupancyStates={'1':'idle','2':'talk','3':'wrap','4':'pause','9':'manual'};
const occupancyLabels={logged:'Tempo logado',pause:'Pausa',available:'Logado sem pausa',talk:'Atendimento',wrap:'Tabulação',idle:'Ocioso (OLOS)',manual:'Chamada manual'};
function olosTime(value) {
  const match=/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:[.,](\d+))?$/.exec(value.trim());
  if(!match)return NaN;
  const [,y,m,d,h,min,s,f='']=match;
  const day=[y,m,d].join('-');
  if(!isoDate(day)||+h>23||+min>59||+s>59)return NaN;
  // Use the clock in the export without applying a browser timezone offset.
  return Date.parse(day+'T'+h+':'+min+':'+s+'.'+f.padEnd(3,'0').slice(0,3)+'Z');
}
function sourceColumns(parsed, fields) {
  const headers=parsed.header.map(key);
  const indexes=fields.map(field=>headers.indexOf(key(field)));
  if(indexes.includes(-1))throw Error('Colunas obrigatórias: '+fields.join(', ')+'.');
  return indexes;
}
function occupancyTimeline(logins,states,campaignRules) {
  const definitions={
    login:['AgentId','CampaignId','StartLogin','EndLogin'],
    state:['AgentId','CampaignId','StartState','EndState','AgentStatus']
  };
  const aliases=campaignAliases(campaignRules);
  const groups=new Map();
  const eventRows=[], seen=new Set();
  let invalid=0, conflicts=0;
  for(const [kind,parts] of [['login',logins],['state',states]]){
    for(const parsed of parts){
      const columns=sourceColumns(parsed,definitions[kind]);
      const headers=parsed.header.map(key);
      const eventId=headers.indexOf(kind==='login'?'LOGINRAWDATAID':'AGENTSTATERAWDATAID');
      const reasonColumn=headers.indexOf('REASON');
      for(const record of parsed.records){
        const [agent,campaign,start,end,status]=columns.map(i=>record[i].trim());
        const code=norm(campaign);
        const matches=aliases.filter(([,values])=>values.has(code));
        if(matches.length!==1)continue;
        const region=matches[0][0];
        const a=olosTime(start),b=olosTime(end);
        const reason=record[reasonColumn]?.trim()||'Sem motivo informado';
        const id=record[eventId]?.trim();
        const identity=JSON.stringify([kind,id||[region,agent,start,end,status,reason]]);
        if(seen.has(identity))continue;
        seen.add(identity);
        const validEnd=Number.isFinite(b)&&b>=a;
        if(agent&&Number.isFinite(a)){
          if(kind==='login'){
            eventRows.push({region,agent,stamp:a,type:'login'});
            if(validEnd)eventRows.push({region,agent,stamp:b,type:'logout'});
          }else if(validEnd&&status==='4'){
            eventRows.push({region,agent,stamp:a,end:b,type:'pause',reason});
          }
        }
        if(!agent||!Number.isFinite(a)||!validEnd){invalid++;continue;}
        if(a===b)continue;
        const group=JSON.stringify([region,agent]);
        const type=kind==='login'?'logged':(occupancyStates[status]??'other');
        if(!groups.has(group))groups.set(group,[]);
        groups.get(group).push([a,type,1],[b,type,-1]);
      }
    }
  }
  const firstReportTime=Date.parse(firstReportDay+'T00:00:00Z');
  const output=[];
  for(const [group,events] of groups){
    const [region,agent]=JSON.parse(group);
    const hours=new Map();
    const active={};
    events.sort((a,b)=>a[0]-b[0]);
    let previous=events[0][0];
    for(const [stamp,type,delta] of events){
      const logged=active.logged>0, idle=active.idle>0;
      if((logged||idle)&&stamp>previous){
        const observed=['pause','talk','wrap','manual','idle'].filter(state=>active[state]>0);
        if(logged&&observed.length>1)conflicts+=stamp-previous;
        const primary=observed[0];
        for(let cursor=Math.max(previous,firstReportTime);cursor<stamp;){
          const bucket=Math.floor(cursor/hourMs)*hourMs;
          const next=Math.min(stamp,bucket+hourMs);
          if(!hours.has(bucket))hours.set(bucket,{logged:0,pause:0,talk:0,wrap:0,idle:0,manual:0});
          const values=hours.get(bucket),duration=next-cursor;
          if(idle)values.idle+=duration;
          if(logged){
            values.logged+=duration;
            if(primary&&primary!=='idle')values[primary]+=duration;
          }
          cursor=next;
        }
      }
      active[type]=(active[type]??0)+delta;
      previous=stamp;
    }
    for(const [bucket,values] of hours){
      const date=new Date(bucket);
      output.push({region,agent,day:date.toISOString().slice(0,10),hour:date.getUTCHours(),...values});
    }
  }
  return {output,eventRows,invalid,conflicts};
}
function summarizeOccupancy(items) {
  const summary={logged:0,pause:0,talk:0,wrap:0,idle:0,manual:0};
  for(const row of items)for(const field of Object.keys(summary))summary[field]+=row[field];
  summary.available=summary.logged-summary.pause;
  summary.occupied=summary.talk+summary.wrap;
  return summary;
}
function clock(ms) {
  const s=Math.round(ms/1000);
  return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(n=>String(n).padStart(2,'0')).join(':');
}
let occupancyRows=[], occupancyEvents=[], agentDirectory=new Map();
function readAgentDirectory(parsed) {
  const headers=parsed.header.map(key);
  const id=headers.indexOf('AGENTID'), name=headers.indexOf('USERNAME');
  if(id<0||name<0)throw Error('Cadastro de agentes: use um CSV com AgentId e UserName.');
  const directory=new Map();
  for(const row of parsed.records){
    const agent=row[id]?.trim(), userName=row[name]?.trim();
    if(agent&&userName)directory.set(agent,userName);
  }
  return directory;
}
function agentLabel(agent) {
  return agentDirectory.get(agent)??'Nome não cadastrado';
}
const agentCollator=new Intl.Collator('pt-BR',{sensitivity:'base',numeric:true});
function compareAgentGroups(left,right,agentIndex){
  const a=JSON.parse(left),b=JSON.parse(right);
  const first=agentDirectory.get(a[agentIndex]),second=agentDirectory.get(b[agentIndex]);
  if(Boolean(first)!==Boolean(second))return first?-1:1;
  return agentCollator.compare(first??'',second??'')||agentCollator.compare(left,right);
}
function occupancyRate(summary) {
  return summary.available>0?summary.occupied/summary.available:null;
}
function syncOccupancyAgents() {
  const control=el('occAgent');
  const selected=control.value;
  const campaign=el('occCampaign').value, from=el('occFrom').value, to=el('occTo').value;
  const inRange=(region,day)=>matchesOccupancy(region,day,0,campaign,from,to,'all');
  const agents=new Set(occupancyRows.filter(row=>row.agent&&inRange(row.region,row.day)).map(row=>row.agent));
  for(const event of occupancyEvents){
    if(event.agent&&(event.type==='login'||event.type==='logout')&&
      inRange(event.region,new Date(event.stamp).toISOString().slice(0,10)))agents.add(event.agent);
  }
  for(const row of rows)if(row.tabData&&row.exceeded&&row.agent&&row.agent!=='0'&&inRange(row.campaign,row.day))agents.add(row.agent);
  setAgentOptions(control,agents,selected);
}
function setAgentOptions(control,agents,selected){
  const sorted=[...agents].sort((a,b)=>agentCollator.compare(agentLabel(a),agentLabel(b))||agentCollator.compare(a,b));
  control.innerHTML='<option value="">Todos</option>'+sorted.map(id=>'<option value="'+html(id)+'">'+html(agentLabel(id))+'</option>').join('');
  control.value=agents.has(selected)?selected:'';
}
function renderOccupancy() {
  syncOccupancyAgents();
  const campaign=el('occCampaign').value, from=el('occFrom').value, to=el('occTo').value;
  const selectedAgent=el('occAgent').value;
  const data=occupancyRows.filter(r=>(!selectedAgent||r.agent===selectedAgent)&&matchesOccupancy(r.region,r.day,r.hour,campaign,from,to,'all'));
  const groupKey=(region,agent,day)=>JSON.stringify([region,agent,day]);
  const groups=groupBy(data,r=>groupKey(r.region,r.agent,r.day));
  const columns=Object.keys(occupancyLabels);
  const exceeded=new Map();
  const coverage=new Set();
  let tabulated=0,unassigned=0;
  for(const row of rows){
    if(!row.tabData||(selectedAgent&&row.agent!==selectedAgent))continue;
    if(!matchesOccupancy(row.campaign,row.day,row.hour,campaign,from,to,'all'))continue;
    tabulated+=row.count;
    if(!row.agent||row.agent==='0'){
      if(row.exceeded)unassigned+=row.count;
      continue;
    }
    const k=groupKey(row.campaign,row.agent,row.day);
    coverage.add(k);
    if(row.exceeded)exceeded.set(k,(exceeded.get(k)??0)+row.count);
  }
  el('occTabStatus').textContent=!rows.length?'Aguardando os dados de discagens.':
    !tabulated?'Nenhuma tabulação disponível neste recorte.':
    unassigned?num(unassigned)+' excedidas sem agente na tentativa. A contagem individual depende do AgentId no CSV.':'';
  el('occTabStatus').hidden=!el('occTabStatus').textContent;
  const counts=new Map();
  for(const event of occupancyEvents){
    const {region,agent,stamp,type}=event;
    if((type!=='login'&&type!=='logout')||(selectedAgent&&agent!==selectedAgent))continue;
    const day=new Date(stamp).toISOString().slice(0,10);
    if(!matchesOccupancy(region,day,0,campaign,from,to,'all'))continue;
    const label=groupKey(region,agent,day);
    if(!counts.has(label))counts.set(label,{login:0,logout:0});
    if(type==='login'||type==='logout')counts.get(label)[type]++;
  }
  const existing=new Set(groups.map(([label])=>label));
  for(const label of new Set([...counts.keys(),...exceeded.keys()]))if(!existing.has(label))groups.push([label,[]]);
  const daily=groups.map(([label,items])=>{
    const [region,agent,day]=JSON.parse(label);
    const events=counts.get(label)??{login:0,logout:0};
    return {region,agent,day,items,...events,exceeded:coverage.has(label)?exceeded.get(label)??0:null};
  });
  const operators=groupBy(daily,row=>row.agent).map(([agent,days])=>({
    agent,
    items:days.flatMap(row=>row.items),
    login:days.reduce((sum,row)=>sum+row.login,0),
    logout:days.reduce((sum,row)=>sum+row.logout,0),
    exceeded:days.some(row=>row.exceeded!==null)?days.reduce((sum,row)=>sum+(row.exceeded??0),0):null
  }));
  const withMetrics=row=>{
    const summary=summarizeOccupancy(row.items);
    return {...row,...summary,rate:occupancyRate(summary)};
  };
  const byName=(a,b)=>Number(!agentDirectory.has(a.agent))-Number(!agentDirectory.has(b.agent))||
    agentCollator.compare(agentLabel(a.agent),agentLabel(b.agent))||agentCollator.compare(a.agent,b.agent);
  const ordered=operators.map(withMetrics).sort(byName);
  const headings=columns.map(k=>'<th scope="col">'+occupancyLabels[k]+'</th>').join('')+
    '<th scope="col">Ocupação</th><th scope="col">Login</th><th scope="col">Logout</th><th scope="col">Tabulações excedidas</th>';
  const cells=row=>columns.map(k=>'<td>'+(row.items.length?clock(row[k]):'—')+'</td>').join('')+
    '<td>'+(row.rate===null?'—':pct(row.occupied,row.available))+'</td><td>'+num(row.login)+
    '</td><td>'+num(row.logout)+'</td><td>'+(row.exceeded===null?'—':num(row.exceeded))+'</td>';
  el('occTable').innerHTML=ordered.length?'<table><thead><tr><th scope="col">Operador</th>'+headings+
    '</tr></thead><tbody>'+ordered.map(row=>'<tr><td>'+html(agentLabel(row.agent))+'</td>'+cells(row)+'</tr>').join('')+
    '</tbody></table>':'<p>Sem sessões, intervalos ociosos ou tabulações excedidas neste recorte.</p>';
  el('occDaily').hidden=!selectedAgent||!daily.length;
  el('occDailyTable').innerHTML=el('occDaily').hidden?'':'<table><thead><tr><th scope="col">Data</th>'+
    '<th scope="col">Campanha</th>'+headings+'</tr></thead><tbody>'+
    daily.map(withMetrics).sort((a,b)=>a.day.localeCompare(b.day)||a.region.localeCompare(b.region))
      .map(row=>'<tr><td>'+br(row.day)+'</td><td>'+campaignNames[row.region]+'</td>'+cells(row)+'</tr>').join('')+
    '</tbody></table>';
}
for(const id of ['occCampaign','occAgent','occFrom','occTo'])el(id).onchange=renderOccupancy;
renderOccupancy();

function matchesOccupancy(region,day,hour,campaign,from,to,scope){
  if(scope==='priority'&&!priority[region])return false;
  const window=scope==='priority'?(region==='PR'?'am':'pm'):scope;
  return day>=firstReportDay&&(!campaign||region===campaign)&&(!from||day>=from)&&(!to||day<=to)&&
    (window==='all'||(window==='am'?hour>=10&&hour<12:hour>=15&&hour<17));
}
function renderPauseChart(pauses,selectedHour){
  const chart=el('pauseChart');
  const totals=new Map();
  for(const pause of pauses){
    if(!pause.started)continue;
    const hour=Number(pause.start.slice(11,13));
    if(!totals.has(hour))totals.set(hour,{count:0,duration:0});
    const total=totals.get(hour);
    total.count++;
    total.duration+=pause.duration;
  }
  const hours=selectedHour===''?Array.from({length:11},(_,i)=>i+8):[Number(selectedHour)];
  const peak=Math.max(1,...hours.map(hour=>totals.get(hour)?.count??0));
  if(!hours.some(hour=>totals.has(hour))){
    chart.innerHTML='<p>Sem pausas iniciadas nas horas exibidas.</p>';
    return;
  }
  chart.innerHTML='<div class="pause-bars">'+hours.map(hour=>{
    const {count,duration}=totals.get(hour)??{count:0,duration:0};
    const label=String(hour).padStart(2,'0')+'h';
    const description='Tempo total em pausa: '+clock(duration);
    return '<button type="button" class="pause-bar" aria-label="'+label+', '+num(count)+(count===1?' pausa':' pausas')+'" aria-describedby="pause-duration-'+hour+'" aria-pressed="false">'+
      '<strong>'+num(count)+'</strong><span class="pause-bar-fill" aria-hidden="true" style="--bar-height:'+Math.max(2,100*count/peak)+'%"></span><span>'+label+'</span>'+
      '<span class="pause-bar-tooltip" id="pause-duration-'+hour+'" role="tooltip">'+description+'</span></button>';
  }).join('')+'</div>';
  for(const bar of chart.querySelectorAll('button')){
    bar.onclick=()=>{
      const pressed=bar.getAttribute('aria-pressed')==='true';
      chart.querySelector('[aria-pressed="true"]')?.setAttribute('aria-pressed','false');
      bar.setAttribute('aria-pressed',String(!pressed));
    };
    bar.onkeydown=event=>{
      if(event.key==='Escape'){
        bar.setAttribute('aria-pressed','false');
        bar.blur();
      }
    };
  }
}
function renderPauses(){
  const campaign=el('pauseCampaign').value, from=el('pauseFrom').value, to=el('pauseTo').value, scope=el('pauseScope').value;
  const selectedHour=el('pauseHour').value;
  const pauses=[];
  for(const event of occupancyEvents){
    if(event.type!=='pause')continue;
    const start=new Date(event.stamp);
    if(selectedHour!==''&&start.getUTCHours()!==Number(selectedHour))continue;
    let duration=0,started=false;
    for(let cursor=event.stamp;cursor<event.end;){
      const date=new Date(cursor);
      const next=Math.min(event.end,(Math.floor(cursor/hourMs)+1)*hourMs);
      if(matchesOccupancy(event.region,date.toISOString().slice(0,10),date.getUTCHours(),campaign,from,to,scope)){
        duration+=next-cursor;
        if(cursor===event.stamp)started=true;
      }
      cursor=next;
    }
    if(duration>0)pauses.push({...event,start:start.toISOString(),duration,started,label:pauseReasonLabel(event.reason)});
  }
  const control=el('pauseAgent');
  setAgentOptions(control,new Set(pauses.map(pause=>pause.agent)),control.value);
  const byAgent=pauses.filter(pause=>!control.value||pause.agent===control.value);
  const typeControl=el('pauseType');
  const previousType=typeControl.value;
  const types=new Set(byAgent.map(pause=>pause.label));
  typeControl.innerHTML='<option value="">Todos</option>'+[...types].sort(agentCollator.compare)
    .map(type=>'<option value="'+html(type)+'">'+html(type)+'</option>').join('');
  typeControl.value=types.has(previousType)?previousType:'';
  const visible=byAgent.filter(pause=>!typeControl.value||pause.label===typeControl.value);
  renderPauseChart(visible,selectedHour);
  const duration=visible.reduce((sum,pause)=>sum+pause.duration,0);
  const count=visible.filter(pause=>pause.started).length;
  el('pauseSummary').textContent=visible.length?num(count)+' pausas iniciadas no recorte · '+clock(duration)+' em pausa.':!applied?'Aguardando os dados publicados.':'Sem pausas disponíveis neste recorte.';
  visible.sort((a,b)=>agentCollator.compare(agentLabel(a.agent),agentLabel(b.agent))||a.stamp-b.stamp);
  el('pauseTable').innerHTML=visible.length?'<table><thead><tr><th>Campanha</th><th>Data de início</th><th>Operador</th><th>Tipo</th><th>Início</th><th>Fim</th><th>Tempo em pausa</th></tr></thead><tbody>'+visible.map(pause=>{
    const end=new Date(pause.end).toISOString();
    const endTime=(end.slice(0,10)!==pause.start.slice(0,10)?br(end.slice(0,10))+' ':'')+end.slice(11,19);
    return     '<tr><td>'+campaignNames[pause.region]+'</td><td>'+br(pause.start.slice(0,10))+'</td><td>'+html(agentLabel(pause.agent))+'</td><td>'+html(pause.label)+'</td><td>'+pause.start.slice(11,19)+'</td><td>'+endTime+'</td><td>'+clock(pause.duration)+'</td></tr>'
  }).join('')+'</tbody></table>':'';
}
for(const id of ['pauseCampaign','pauseFrom','pauseTo','pauseScope','pauseHour','pauseAgent','pauseType'])el(id).onchange=renderPauses;
renderPauses();
