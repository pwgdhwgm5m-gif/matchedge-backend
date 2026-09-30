// Central outbound API quota guard. Keeps provider budgets independent from business logic.
const buckets=new Map();
const nowDay=()=>new Date().toISOString().slice(0,10);
const limits={
  sportmonks:{daily:Number(process.env.SPORTMONKS_DAILY_BUDGET||0),reserve:.10},
  bsd:{daily:Number(process.env.BSD_DAILY_BUDGET||0),reserve:.10},
  thesportsdb:{daily:Number(process.env.SPORTSDB_DAILY_BUDGET||0),reserve:.15,perMinute:Number(process.env.SPORTSDB_PER_MINUTE_BUDGET||90)},
  footballDataOrg:{daily:Number(process.env.FOOTBALL_DATA_DAILY_BUDGET||0),reserve:.15,perMinute:Number(process.env.FOOTBALL_DATA_PER_MINUTE_BUDGET||8)},
  freeFootball:{daily:Number(process.env.FREE_FOOTBALL_DAILY_BUDGET||0),reserve:.15,perMinute:Number(process.env.FREE_FOOTBALL_PER_MINUTE_BUDGET||20)},
  oddsApi:{daily:Number(process.env.ODDS_API_DAILY_BUDGET||0),reserve:.20,perMinute:Number(process.env.ODDS_API_PER_MINUTE_BUDGET||10)},
  apiFootball:{daily:Number(process.env.API_FOOTBALL_DAILY_BUDGET||0),reserve:.15,perMinute:Number(process.env.API_FOOTBALL_PER_MINUTE_BUDGET||8)},
  tff:{daily:Number(process.env.TFF_DAILY_BUDGET||0),reserve:.15,perMinute:Number(process.env.TFF_PER_MINUTE_BUDGET||10)}
};
function state(provider){
  const cfg=limits[provider]||{}; const day=nowDay(); let s=buckets.get(provider);
  if(!s||s.day!==day){s={day,count:0,minute:Math.floor(Date.now()/60000),minuteCount:0,blockedUntil:0};buckets.set(provider,s);}
  const minute=Math.floor(Date.now()/60000); if(s.minute!==minute){s.minute=minute;s.minuteCount=0;}
  return {s,cfg};
}
function canCall(provider,{critical=false}={}){
  const {s,cfg}=state(provider); if(Date.now()<s.blockedUntil)return false;
  if(cfg.perMinute&&s.minuteCount>=cfg.perMinute)return false;
  if(cfg.daily>0){const usable=Math.floor(cfg.daily*(1-(critical?0:cfg.reserve||0)));if(s.count>=usable)return false;}
  return true;
}
function record(provider){const {s}=state(provider);s.count++;s.minuteCount++;}
function rateLimited(provider,retryMs=60000){const {s}=state(provider);s.blockedUntil=Math.max(s.blockedUntil,Date.now()+retryMs);}
function status(){return Object.fromEntries(Object.keys(limits).map(p=>{const {s,cfg}=state(p);return[p,{day:s.day,used:s.count,dailyBudget:cfg.daily||null,minuteUsed:s.minuteCount,minuteBudget:cfg.perMinute||null,blockedUntil:s.blockedUntil||null}];}));}
module.exports={canCall,record,rateLimited,status,limits};
