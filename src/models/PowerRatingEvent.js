const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  league:{type:String,required:true,index:true},
  fixtureId:{type:String,required:true},
  kickoff:{type:Date,default:null},
  homeTeamId:{type:String,default:null},
  awayTeamId:{type:String,default:null},
  processedAt:{type:Date,default:Date.now}
},{minimize:false});
schema.index({league:1,fixtureId:1},{unique:true});
module.exports=mongoose.model('PowerRatingEvent',schema);
