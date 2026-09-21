const mongoose=require('mongoose');
const schema=new mongoose.Schema({
 username:{type:String,required:true,default:'adminxyz',lowercase:true,index:true},
 credentialID:{type:String,required:true,unique:true},
 publicKey:{type:String,required:true},
 counter:{type:Number,default:0},
 transports:[String],
 deviceName:{type:String,default:'Passkey'},
 createdAt:{type:Date,default:Date.now},
 lastUsedAt:{type:Date,default:null}
});
module.exports=mongoose.model('AdminPasskey',schema);
