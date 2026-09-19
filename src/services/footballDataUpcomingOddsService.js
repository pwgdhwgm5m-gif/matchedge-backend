'use strict';

const https = require('https');

const UPCOMING_URL = 'https://www.football-data.co.uk/fixtures.csv';
const CACHE_MS = 30 * 60 * 1000;
let cache = { at: 0, rows: [] };

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'SoccerEdge-Pro/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return fetchText(new URL(res.headers.location, url).toString()).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('Football-Data HTTP ' + res.statusCode));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject).setTimeout(10000, function () {
      this.destroy(new Error('Football-Data timeout'));
    });
  });
}

function parseCsvLine(line) {
  const out=[]; let cur=''; let quoted=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){
      if(quoted && line[i+1]==='"'){cur+='"';i++;} else quoted=!quoted;
    } else if(ch===',' && !quoted){out.push(cur);cur='';}
    else cur+=ch;
  }
  out.push(cur); return out;
}

function num(v){ const n=Number(v); return Number.isFinite(n)&&n>0?n:null; }

function parseUpcoming(csv) {
  const lines=String(csv||'').replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean);
  if(lines.length<2) return [];
  const headers=parseCsvLine(lines[0]).map(x=>x.trim());
  return lines.slice(1).map(line=>{
    const values=parseCsvLine(line); const r={};
    headers.forEach((h,i)=>{r[h]=values[i]??'';});
    return {
      division:r.Div||null,date:r.Date||null,time:r.Time||null,
      homeTeam:r.HomeTeam||null,awayTeam:r.AwayTeam||null,
      odds:{
        home:num(r.B365H)||num(r.BWH)||num(r.IWH)||num(r.PSH)||num(r.WHH)||num(r.VCH),
        draw:num(r.B365D)||num(r.BWD)||num(r.IWD)||num(r.PSD)||num(r.WHD)||num(r.VCD),
        away:num(r.B365A)||num(r.BWA)||num(r.IWA)||num(r.PSA)||num(r.WHA)||num(r.VCA),
        over25:num(r.B365O2_5)||num(r.PO2_5)||num(r.MaxO2_5)||num(r.AvgO2_5),
        under25:num(r.B365U2_5)||num(r.PU2_5)||num(r.MaxU2_5)||num(r.AvgU2_5)
      }
    };
  }).filter(x=>x.homeTeam&&x.awayTeam);
}

async function getUpcomingOdds({force=false}={}) {
  if(!force && cache.rows.length && Date.now()-cache.at<CACHE_MS) return {source:'football-data.co.uk',cached:true,rows:cache.rows};
  const csv=await fetchText(UPCOMING_URL);
  const rows=parseUpcoming(csv);
  cache={at:Date.now(),rows};
  return {source:'football-data.co.uk',cached:false,rows};
}

module.exports={getUpcomingOdds,parseUpcoming,UPCOMING_URL};
