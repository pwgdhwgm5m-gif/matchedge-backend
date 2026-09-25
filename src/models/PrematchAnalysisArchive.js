const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  sourceFixtureId: {type:String,required:true,index:true},
  canonicalProvider: {type:String,default:''},
  homeKey: {type:String,required:true},
  awayKey: {type:String,required:true},
  homeTeam: {type:String,required:true},
  awayTeam: {type:String,required:true},
  league: {type:String,default:''},
  kickoff: {type:Date,required:true,index:true},
  capturedAt: {type:Date,required:true},
  analysis: {type:mongoose.Schema.Types.Mixed,required:true}
}, {minimize:false});

schema.index({sourceFixtureId:1,homeKey:1,awayKey:1,kickoff:1},{unique:true});
schema.index({homeKey:1,awayKey:1,kickoff:1});

module.exports=mongoose.model('PrematchAnalysisArchive',schema);
