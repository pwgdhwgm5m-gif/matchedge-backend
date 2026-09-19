'use strict';
const express=require('express');
const router=express.Router();
const {getUpcomingOdds}=require('../services/footballDataUpcomingOddsService');

router.get('/',async(req,res)=>{
  try{
    const data=await getUpcomingOdds();
    const date=String(req.query.date||'').trim();
    const team=String(req.query.team||'').trim().toLowerCase();
    let rows=data.rows;
    if(date) rows=rows.filter(x=>x.date===date);
    if(team) rows=rows.filter(x=>String(x.homeTeam).toLowerCase().includes(team)||String(x.awayTeam).toLowerCase().includes(team));
    res.json({source:data.source,cached:data.cached,count:rows.length,matches:rows});
  }catch(error){
    // Isolated failure: never affects fixtures or analysis providers.
    res.status(503).json({source:'football-data.co.uk',available:false,matches:[],error:'Market odds temporarily unavailable'});
  }
});
module.exports=router;
