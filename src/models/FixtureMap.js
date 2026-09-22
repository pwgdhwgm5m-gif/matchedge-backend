const mongoose=require('mongoose');

const providerRefSchema=new mongoose.Schema({
  provider:{type:String,required:true,enum:['sportsdb','sportmonks','bsd','football-data']},
  id:{type:String,required:true},
  homeName:{type:String,default:''},awayName:{type:String,default:''},
  confidence:{type:Number,default:1,min:0,max:1},
  resolvedAt:{type:Date,default:Date.now}
},{_id:false});

const fixtureMapSchema=new mongoose.Schema({
  canonicalKey:{type:String,required:true,unique:true,index:true},
  kickoffDate:{type:String,required:true,index:true},
  homeCanonical:{type:String,required:true,index:true},
  awayCanonical:{type:String,required:true,index:true},
  aliases:{type:[String],default:[]},
  providers:{type:[providerRefSchema],default:[]},
  updatedAt:{type:Date,default:Date.now}
});
fixtureMapSchema.index({kickoffDate:1,homeCanonical:1,awayCanonical:1});
module.exports=mongoose.model('FixtureMap',fixtureMapSchema);
