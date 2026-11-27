'use strict';
let cobmaisTotals={};

function overviewRows(){
  if(!Array.isArray(cobmaisTotals.outcomes))return rows;
  return rows.map(row=>({...row,cpc:false,deal:false})).concat(cobmaisTotals.outcomes.map(event=>({
    day:event.day,hour:event.hour,campaign:event.campaign,operator:event.operator,
    window:event.hour==null?'Sem hora':event.hour>=10&&event.hour<12?morning:event.hour>=15&&event.hour<17?afternoon:'Outras',
    outcomeOnly:true,[event.metric]:true
  })));
}
