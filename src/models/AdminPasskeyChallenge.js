const mongoose=require('mongoose');
const schema=new mongoose.Schema({key:{type:String,unique:true,required:true},challenge:{type:String,required:true},kind:{type:String,enum:['registration','authentication'],required:true},expiresAt:{type:Date,required:true,expires:0}});
module.exports=mongoose.model('AdminPasskeyChallenge',schema);
