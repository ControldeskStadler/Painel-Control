'use strict';
(async()=>{
  const status=el('publishedStatus');
  try{
    const response=await fetch('./dados.json',{cache:'no-cache'});
    if(response.status===404){status.textContent='Aguardando a primeira publicação de dados.';return;}
    if(!response.ok)throw Error();
    const snapshot=await response.json();
    if(snapshot.version!==1||!Array.isArray(snapshot.rows))throw Error();
    applied=true;
    setAnalysis({output:snapshot.rows});
    status.textContent='Dados publicados em '+new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(snapshot.updatedAt));
  }catch{
    status.textContent='Não foi possível carregar os dados publicados.';
  }
})();
