const mongoose=require('mongoose');
const schema=new mongoose.Schema({eventId:{type:String,required:true,unique:true,index:true},kind:{type:String,default:'smart'},sentAt:{type:Date,default:Date.now,index:true}},{versionKey:false});
schema.index({sentAt:1},{expireAfterSeconds:604800});
module.exports=mongoose.model('NotificationEvent',schema);
