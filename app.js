'use strict';
const firstReportDay='2026-11-01';
const el = id => document.getElementById(id);
const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toUpperCase();
const key = value => norm(value).replace(/[^A-Z0-9]/g,'');
const html = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const list = value => value.split(',').map(norm).filter(Boolean);
const num = value => value == null ? '—' : value.toLocaleString('pt-BR',{maximumFractionDigits:2});
const percentFormat = new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const pct = (a,b) => a == null || !b ? '—' : percentFormat.format(100*a/b)+'%';
const br = day => day.split('-').reverse().join('/');
const morning = '10h–12h', afternoon = '15h–17h';
const priority = {PR:morning,SC:afternoon};
const campaignNames = {PR:'DAY_PR_LEVES',SC:'DAY_SC_LEVES',WO:'DAY_WO',PESADOS:'DAY_PESADOS_GERAL'};
const campaignIds={PR:"52",SC:"51",WO:"47",PESADOS:"60"};
function campaignAliases(rules){
  return Object.entries(campaignNames).map(([region,name])=>[region,new Set(["WO","PESADOS"].includes(region)
    ? [campaignIds[region],name,region==="WO"?"DAY - WO":"DAY - PESADOS _GERAL"]
    : list(rules[region.toLowerCase()]))]);
}
const baseline = ['2026-11-10','2026-11-11','2026-11-12'];
const sources = {attempt:'Tentativas', tab:'Tabulações', tel:'Telefonia', contract:'Contratos'};
const defaults = {
  pr:'52, DAY - LEVES - PR - 16-360, PR, '+campaignNames.PR,
  sc:'51, DAY - LEVES - SC - 16-360, SC, '+campaignNames.SC,
  cpc:'103, 107, 122, 407, 409, 410, 420, CONTATO COM CLIENTE, ACORDO, ALEGA PAGAMENTO, PREVENTIVO - CONFIRMA PAGAMENTO, Pagamento, Proposta',
  deal:'103, ACORDO', hang:'413, ATENDE E DESLIGA',
  hello:'ALÔ, HUMANO, ATENDIMENTO HUMANO, ATENDEU, TERCEIRO, CONTATO COM TERCEIRO, CONTATO COM TERCEIROS',
  no:'NÃO ATENDE, NO ANSWER, NOANSWER', box:'CAIXA POSTAL, VOICEMAIL', drop:'CHAMADA DERRUBADA, CHAMADAS DERRUBADAS'
};
const names = {pr:'Campanha PR · IDs e nomes',sc:'Campanha SC · IDs e nomes',cpc:'CPC',deal:'Acordo',hang:'Atende e desliga',hello:'Alô humano e terceiros',no:'Não atende',box:'Caixa postal · PBX 17 e 18',drop:'Derrubadas · PBX 26 (Tear down)'};
const fields = {
  id:['ID da discagem','CallId','AttemptId','DialingId','CallHistoryId','IdChamada','InteractionId','CallIdentifier','IdDiscagem','TelecomCallid','CallIdTelecom'],
  agent:['ID do agente','AgentId','IdAgente','OperatorId'],
  telecom:['ID da discagem na telefonia','CallIdTelecom','TelecomCallid'],
  campaign:['Campanha','CampaignName','Campaign','NomeCampanha'],
  campaignId:['ID da campanha','CampaignId','IdCampanha'],
  date:['Data e hora ou data','StartDate','CallDate','StartTime','DialingDate','DateTime','DataHora','Data','Date','DataInicio','CallStart','StartDateTime','DialStartTime'],
  time:['Hora separada','Hora','HoraInicio','Time','CallTime'],
  tab:['Código de tabulação','DispositionId','TabulationId','TipificationId','ReasonId','DispositionCode','TabulacaoId','CodigoTabulacao'],
  tabLabel:['Descrição da tabulação','Disposition','Tabulation','Tipification','TabulationName','DispositionName','Tabulacao','DescricaoTabulacao'],
  tel:['Código de telefonia','CallResultId','TelephonyCode','DialerResultId','SipCode','CodigoTelefonia','PbxDispositionId'],
  telLabel:['Resultado de telefonia','CallResult','TelephonyResult','DialerResult','StatusTelefonia','CallStatus','ResultadoTelefonia'],
  contract:['Identificador de contrato','ContractId','ContractNumber','Contrato','NumeroContrato','IdContrato']
};
const roles = {attempt:Object.keys(fields),tab:['id','tab','tabLabel'],tel:['id','tel','telLabel'],contract:['id','contract']};
let criteria = structuredClone(defaults), applied = null, rows = [];
function show(page) {
  for (const section of document.querySelectorAll('main section')) section.hidden = section.id !== page;
  for (const button of document.querySelectorAll('nav button')) {
    button.classList.toggle('active', button.dataset.page === page);
    if (button.dataset.page === page) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
  }
  if(page==='occupancy')renderOccupancy();
  if(page==='pauses')renderPauses();
  window.scrollTo(0,0);
}
function parseCSV(text, selectRecords) {
  const first = text.split(/\r?\n/,1)[0].replace(/"(?:""|[^"])*"/g,'');
  const sep = [';',',','\t','|'].sort((a,b)=>first.split(b).length-first.split(a).length)[0];
  const records = [];
  let header, select;
  let row = [], value = '', quoted = false;
  const finish = () => {
    row.push(value);
    if(row.some(v=>v.trim())){
      if(!header){
        header=row.map(v=>v.trim());
        select=selectRecords?.(header);
      }else{
        if(row.length!==header.length)throw Error('Há registros com quantidade de colunas diferente do cabeçalho.');
        const selected=select?select(row):row;
        if(selected)records.push(selected);
      }
    }
    row=[]; value='';
  };
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){
      if(quoted && text[i+1]==='"'){value+='"';i++;}
      else if(quoted || !value) quoted=!quoted;
      else value+=c;
    } else if(!quoted && c===sep){row.push(value);value='';}
    else if(!quoted && (c==='\n'||c==='\r')){finish();if(c==='\r'&&text[i+1]==='\n')i++;}
    else value+=c;
  }
  if(quoted) throw Error('Campo com aspas sem fechamento.');
  finish();
  if(!header?.length) throw Error('CSV sem cabeçalho.');
  return {header,records};
}
function isoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if(!match) return false;
  const d=new Date(value+'T00:00:00Z');
  return Number.isFinite(+d) && d.toISOString().slice(0,10)===value;
}
function dateHour(value,separate) {
  const s=value.trim();
  const iso=/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ](\d{1,2}):\d{2})?/.exec(s);
  const local=/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):\d{2})?/.exec(s);
  if(!iso&&!local) return [];
  const [,year,month,day,hour]=iso||[null,local[3],local[2],local[1],local[4]];
  const date=[year,month.padStart(2,'0'),day.padStart(2,'0')].join('-');
  const h=Number((separate.trim().match(/^(\d{1,2})(?::|$)/)?.[1]) ?? hour ?? NaN);
  return isoDate(date)&&h>=0&&h<=23 ? [date,h] : [];
}
function calculate(sourcesData,rules) {
  const attempt=sourcesData.attempt;
  if(!attempt)return {output:[],diagnostics:{}};
  const mapped=(source,f)=>source?.map[f]!==''&&source?.map[f]!=null;
  if(!mapped(attempt,'date')||!(mapped(attempt,'campaign')||mapped(attempt,'campaignId'))) throw Error('Mapeie a data/hora e a campanha em Tentativas.');
  const aliases=campaignAliases(rules);
  const codes=Object.fromEntries(Object.entries(rules).map(([k,v])=>[k,new Set(list(v))]));
  if([...codes.pr].some(v=>codes.sc.has(v))) throw Error('Remova os identificadores de campanha que aparecem tanto em PR quanto em SC.');
  if([...codes.hang].some(v=>codes.drop.has(v))||codes.drop.has('413')||codes.drop.has('ATENDE E DESLIGA')) throw Error('Retire 413 e os rótulos de Atende e desliga dos critérios de chamadas derrubadas.');
  const linked={};
  const tel=sourcesData.tel;
  const usesTelecomId=['TELECOMCALLID','CALLIDTELECOM'].includes(key(tel?.header?.[tel.map.id]));
  const pbxLabels={'5':'NO ANSWER','17':'CAIXA POSTAL','18':'CAIXA POSTAL','19':'HUMAN ANSWER','26':'CHAMADA DERRUBADA'};
  const isPbx=key(tel?.header?.[tel.map.tel])==='PBXDISPOSITIONID';
  const diagnostics={unknown:0,invalid:0,conflict:0,duplicates:0,matched:{},unlinked:{},ambiguousContracts:0};
  const seenIds=new Set(), seenTelecom=new Set();
  for(const role of ['tab','tel','contract']){
    const source=sourcesData[role];
    if(!source)continue;
    if(!mapped(source,'id')||!mapped(attempt,role==='tel'&&usesTelecomId?'telecom':'id')) throw Error('Mapeie o ID da discagem em Tentativas e '+sources[role]+'.');
    if(!roles[role].slice(1).some(f=>mapped(source,f))) throw Error('Mapeie os campos de resultado em '+sources[role]+'.');
    const index=new Map();
    for(const record of source.records){
      const id=source.read(record,'id');
      if(!id)continue;
      if(!index.has(id))index.set(id,new Set());
      for(const field of roles[role].slice(1)){
        const v=source.read(record,field);
        if(v){
          index.get(id).add(v);
          if(role==='tel'&&isPbx&&field==='tel'&&pbxLabels[v]) index.get(id).add(pbxLabels[v]);
        }
      }
    }
    linked[role]=index;
    diagnostics.matched[role]=0;
  }
  const output=[];
  for(const record of attempt.records){
    const get=f=>attempt.read(record,f);
    const id=get('id'), telecomId=get('telecom');
    if(telecomId)seenTelecom.add(telecomId);
    if(id && seenIds.has(id))diagnostics.duplicates++;
    if(id)seenIds.add(id);
    const campaignFields=[get('campaign'),get('campaignId')].map(norm);
    const matches=aliases.filter(([,values])=>campaignFields.some(value=>values.has(value)));
    if(matches.length>1){diagnostics.conflict++;continue;}
    const campaign=matches[0]?.[0];
    if(!campaign){diagnostics.unknown++;continue;}
    const [day,hour]=dateHour(get('date'),get('time'));
    if(!day){diagnostics.invalid++;continue;}
    if(day<firstReportDay)continue;
    const extend=(role,base)=>{
      const values=linked[role]?.get(role==='tel'&&usesTelecomId?telecomId:id);
      if(values?.size)diagnostics.matched[role]++;
      return [...base,...(values??[])].filter(Boolean);
    };
    const t=extend('tab',[get('tab'),get('tabLabel')]).map(norm);
    const phone=extend('tel',[get('tel'),get('telLabel')]).map(norm);
    const contractIds=new Set(extend('contract',[get('contract')]));
    if(contractIds.size>1)diagnostics.ambiguousContracts++;
    const all=[...t,...phone];
    const has=(metric,values)=>values.some(v=>codes[metric].has(v));
    const deal=has('deal',t);
    const cpc=deal||has('cpc',t);
    const hang=all.includes('413')||all.includes('ATENDE E DESLIGA')||has('hang',all);
    const talking=sourcesData.talking;
    const campaignKey=get('campaignId')||campaignIds[campaign];
    const attended=Boolean(id&&id!=='0'&&talking?.calls.has(campaignKey+'|'+id));
    const attendanceData=attended||Boolean(talking?.days.has(campaignKey+'|'+day));
    output.push({campaign,day,hour,attended,attendanceData,agent:get('agent'),exceeded:t.some(value=>value==='OUTROS'||/^421(?:[.,]0+)?$/.test(value)),window:hour>=10&&hour<12?morning:hour>=15&&hour<17?afternoon:'Outras',
      contract:contractIds.size===1?[...contractIds][0]:'',deal,cpc,hang,hello:cpc||hang||phone.includes('HUMAN ANSWER')||has('hello',all),
      no:has('no',all),box:has('box',all),drop:!hang&&has('drop',all),tabData:t.length>0,telData:phone.length>0,outcomeData:all.length>0});
  }
  for(const [role,index] of Object.entries(linked)) diagnostics.unlinked[role]=[...index.keys()].filter(id=>!(role==='tel'&&usesTelecomId?seenTelecom:seenIds).has(id)).length;
  return {output,diagnostics};
}
function setAnalysis(result) {
  rows=result.output;
  render();
}
const labels={n:'Tentativas',hello:'Alô',helloRate:'Taxa de alô',attended:'Atendida',cpc:'CPC',cpcRate:'Taxa de CPC',deal:'Acordos',no:'Não atende',box:'Caixa postal',hang:'Atende e desliga',drop:'Derrubadas',exceeded:'Tabulações excedidas'};
const metricKeys=Object.keys(labels);
function aggregate(data) {
  const values={n:data.reduce((sum,row)=>sum+row.count,0)};
  for(const k of ['hello','attended','cpc','deal','no','box','hang','drop','exceeded']) values[k]=data.reduce((sum,row)=>sum+(row[k]?row.count:0),0);
  if(!data.some(r=>r.tabData)){values.cpc=null;values.deal=null;values.exceeded=null;}
  if(!data.some(r=>r.attendanceData))values.attended=null;
  if(!data.some(r=>r.outcomeData)){values.hello=null;values.hang=null;values.no=null;}
  if(!data.some(r=>r.telData)){
    if(!values.box)values.box=null;
    if(!values.drop)values.drop=null;
  }
  if(!data.length)values.n=null;
  return values;
}
function display(a,k) {
  if(k==='helloRate'||k==='cpcRate')return pct(a[k.replace('Rate','')],a.n);
  return num(a[k]);
}
function table(title, data, keys=metricKeys) {
  if(!data.length)return '<div class="empty">Sem registros para exibir neste recorte.</div>';
  return '<table><thead><tr><th>'+title+'</th>'+keys.map(k=>'<th>'+labels[k]+'</th>').join('')+'</tr></thead><tbody>'+
    data.map(([label,a])=>'<tr><td>'+html(label)+'</td>'+keys.map(k=>'<td>'+display(a,k)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
}
function groupBy(data,fn) {
  const groups=new Map();
  for(const r of data){const k=fn(r);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}
  return [...groups.entries()].sort(([a],[b])=>a.localeCompare(b,'pt-BR',{numeric:true}));
}
function renderOperatorRanking(data) {
  const metric=el('rankMetric').value==='deal'?'deal':'attended';
  const operators=new Map();
  for(const row of data){
    if(!row.agent||row.agent==='0')continue;
    if(!operators.has(row.agent))operators.set(row.agent,{attended:0,deal:0,attendanceData:false,tabData:false});
    const totals=operators.get(row.agent);
    totals.attended+=row.attended?row.count:0;
    totals.deal+=row.deal?row.count:0;
    totals.attendanceData||=row.attendanceData;
    totals.tabData||=row.tabData;
  }
  const name=id=>typeof agentDirectory==='undefined'?'Operador '+id:agentDirectory.get(id)||'Operador '+id;
  const ranking=[...operators].filter(([,a])=>a[metric]>0)
    .sort(([id,a],[other,b])=>b[metric]-a[metric]||name(id).localeCompare(name(other),'pt-BR',{sensitivity:'base'}))
    .slice(0,5);
  const empty=metric==='deal'?'Nenhum acordo atribuído a operadores neste recorte.':'Nenhuma atendida atribuída a operadores neste recorte.';
  el('operatorRanking').innerHTML=ranking.length?'<table><thead><tr><th>Operador</th><th>Atendidas</th><th>Acordos</th></tr></thead><tbody>'+
    ranking.map(([id,a],i)=>'<tr><td>'+(i+1)+'. '+html(name(id))+'</td><td>'+num(a.attendanceData?a.attended:null)+'</td><td>'+num(a.tabData?a.deal:null)+'</td></tr>').join('')+
    '</tbody></table>':'<p>'+(!applied?'Aguardando os dados publicados.':empty)+'</p>';
}
function overview() {
  const group=el('group').value,campaign=el('campaign').value,hour=el('overviewHour').value;
  const from=el('from').value,to=el('to').value;
  const invalidRange=Boolean(from&&to&&from>to);
  const data=invalidRange?[]:rows.filter(r=>(!campaign||r.campaign===campaign)&&(!from||r.day>=from)&&(!to||r.day<=to)&&(hour===''||r.hour===Number(hour)));
  const messages=[];
  if(invalidRange)messages.push('A data inicial deve ser anterior ou igual à data final.');
  else if(from||to){
    if(applied&&!rows.some(r=>(!from||r.day>=from)&&(!to||r.day<=to)))messages.push('O ZIP carregado não contém tentativas nesse período.');
  }
  if(!data.length&&applied&&!invalidRange&&!messages.length)messages.push('Nenhuma tentativa corresponde aos filtros selecionados.');
  el('dateFeedback').textContent=messages.join(' ');
  renderOperatorRanking(data);
  const a=aggregate(data);
  const mode=el('chartMetric').value;
  el('stats').innerHTML=metricKeys.map(k=>'<button type="button" class="stat" data-metric="'+k+
    '" aria-controls="chart" aria-pressed="'+(k===mode)+'"><span>'+labels[k]+'</span><strong>'+display(a,k)+'</strong></button>').join('');
  for(const card of el('stats').querySelectorAll('button'))card.onclick=()=>{
    el('chartMetric').value=card.dataset.metric;
    overview();
    el('stats').querySelector('[data-metric="'+card.dataset.metric+'"]').focus();
  };
  const groups=groupBy(data,r=>[campaignNames[r.campaign],group==='day'?r.day:group==='hour'?r.hour+'h':group==='window'?r.window:group==='detail'?r.day+' '+r.hour+'h':''].filter(Boolean).join(' · '));
  el('detail').innerHTML=table('Campanha',groups.map(([label,items])=>[label.replace(/\d{4}-\d{2}-\d{2}/g,br),aggregate(items)]));
  const points=groupBy(data,r=>String(r.hour)).map(([h,items])=>{
    const metrics=aggregate(items);
    const value=mode.endsWith('Rate')?(metrics[mode.slice(0,-4)] ?? 0)/metrics.n:metrics[mode];
    return {h,value,label:display(metrics,mode)};
  });
  const max=Math.max(1e-9,...points.map(({value})=>value??0));
  const selectableHours=new Set(Array.from(el('overviewHour').options,option=>option.value));
  el('chart').innerHTML=points.some(({label})=>label!=='—')?points.map(({h,value,label})=>{
    const hourLabel=String(h).padStart(2,'0')+'h';
    const bar='<strong class="bar-value">'+label+'</strong><i aria-hidden="true" style="height:'+((value??0)/max*94)+'px"></i><span>'+hourLabel+'</span>';
    if(!selectableHours.has(h))return '<div class="bar">'+bar+'</div>';
    return '<button type="button" class="bar chart-hour" data-hour="'+h+'" aria-pressed="'+(hour===h)+
      '" aria-label="'+hourLabel+' · '+labels[mode]+' · '+label+'">'+bar+'</button>';
  }).join(''):'<div class="empty">'+(applied?'Sem dados para o indicador selecionado.':'Aguardando os dados publicados.')+'</div>';
  for(const bar of el('chart').querySelectorAll('button'))bar.onclick=()=>{
    el('overviewHour').value=hour===bar.dataset.hour?'':bar.dataset.hour;
    overview();
    (el('chart').querySelector('[data-hour="'+bar.dataset.hour+'"]')??el('overviewHour')).focus();
  };

}
function render(){overview();}
for(const b of document.querySelectorAll('[data-page]')) b.onclick=()=>show(b.dataset.page);
el('chartMetric').innerHTML=metricKeys.map(k=>'<option value="'+k+'">'+labels[k]+'</option>').join('');
for(const id of ['campaign','from','to','overviewHour','group','chartMetric','rankMetric'])el(id).onchange=overview;
for(const id of ['from','to'])el(id).oninput=overview;
el('reset').onclick=()=>{for(const id of ['campaign','from','to','overviewHour'])el(id).value='';overview();};
render();
