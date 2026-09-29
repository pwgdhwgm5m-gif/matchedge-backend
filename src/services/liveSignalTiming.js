function liveMinute(f){
  for(const raw of [f?.minute,f?.time?.minute,f?.timer?.minute,f?.status?.minute,f?.elapsed]){
    if(raw==null||raw==='')continue;
    const n=Number(raw);
    if(Number.isFinite(n)&&n>0&&n<=130)return Math.round(n);
  }
  return null;
}
function signalTiming(f,now=Date.now()){
  const minute=liveMinute(f);
  if(minute!=null)return {eligible:minute>=10&&minute<=88,minute};
  const seconds=Number(f?.kickoff_ts);
  const kickoff=Number.isFinite(seconds)&&seconds>0?seconds*1000:Date.parse(f?.kickoff_utc||f?.start_time||'');
  const elapsed=(now-kickoff)/60000;
  return {eligible:Number.isFinite(elapsed)&&elapsed>=10&&elapsed<=115,minute:null};
}
module.exports={liveMinute,signalTiming};
