'use strict';
(async()=>{
  const status=el('publishedStatus');
  try{
    const response=await fetch('./dados.json',{cache:'no-cache'});
    if(response.status===404){status.textContent='Aguardando a primeira publicação de dados.';return;}
    if(!response.ok)throw Error();
    const snapshot=await response.json();
    if(snapshot.version!==4){
      status.textContent='Gere um novo dados.json pela cópia local deste pacote.';
      return;
    }
    if(![snapshot.rows,snapshot.times,snapshot.events,snapshot.operators].every(Array.isArray))throw Error();
    const ids=new Set([...snapshot.rows,...snapshot.times,...snapshot.events].map(row=>row.agent).filter(Boolean));
    const names=new Map(snapshot.operators);
    agentDirectory=new Map([...ids].map(id=>[id,names.get(id)||'Nome não cadastrado']));
    occupancyRows=snapshot.times;
    occupancyEvents=snapshot.events;
    applied=true;
    if(snapshot.cobmais)cobmaisTotals=snapshot.cobmais;
    setAnalysis({output:snapshot.rows});
    renderOccupancy();
    renderPauses();
    el('occStatus').hidden=true;
    status.textContent='Dados publicados em '+new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(snapshot.updatedAt));
  }catch{
    status.textContent='Não foi possível carregar os dados publicados.';
  }
})();
