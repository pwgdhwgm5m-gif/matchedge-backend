const express=require('express');
const crypto=require('crypto');
const {generateRegistrationOptions,verifyRegistrationResponse,generateAuthenticationOptions,verifyAuthenticationResponse}=require('@simplewebauthn/server');
const User=require('../models/User');
const AdminPasskey=require('../models/AdminPasskey');
const Challenge=require('../models/AdminPasskeyChallenge');
const {generateToken}=require('../services/authService');
const router=express.Router();
const USERNAME='adminxyz';
const RP_NAME='SoccerEdge Pro Admin';
const RP_ID=process.env.ADMIN_PASSKEY_RP_ID||'socceredgepro.com';
const ORIGINS=(process.env.ADMIN_PASSKEY_ORIGINS||'https://app.socceredgepro.com,https://matchedge-backend-kujb.onrender.com').split(',').map(x=>x.trim()).filter(Boolean);
const b64u=b=>Buffer.from(b).toString('base64url');
const from64=s=>Buffer.from(s,'base64url');
async function saveChallenge(key,challenge,kind){await Challenge.findOneAndUpdate({key},{challenge,kind,expiresAt:new Date(Date.now()+5*60*1000)},{upsert:true,new:true});}
async function takeChallenge(key,kind){const c=await Challenge.findOneAndDelete({key,kind});if(!c||c.expiresAt<Date.now())return null;return c.challenge;}
async function adminUser(){return User.findOne({username:USERNAME,role:'admin'});}
router.get('/status',async(req,res)=>{const count=await AdminPasskey.countDocuments({username:USERNAME});res.json({username:'AdminXYZ',configured:count>0,credentials:count});});
router.post('/register/options',async(req,res)=>{
 const existing=await AdminPasskey.find({username:USERNAME});
 if(existing.length) return res.status(403).json({error:'Passkey enrollment is already locked. Add devices from an authenticated admin session.'});
 const user=await adminUser(); if(!user)return res.status(409).json({error:'AdminXYZ administrator is not provisioned yet.'});
 const options=await generateRegistrationOptions({rpName:RP_NAME,rpID:RP_ID,userName:'AdminXYZ',userID:Buffer.from(String(user._id)),attestationType:'none',excludeCredentials:existing.map(x=>({id:x.credentialID,transports:x.transports})),authenticatorSelection:{residentKey:'preferred',userVerification:'required'}});
 const key=crypto.randomUUID();await saveChallenge(key,options.challenge,'registration');res.json({key,options});
});
router.post('/register/verify',async(req,res)=>{
 try{const expectedChallenge=await takeChallenge(req.body.key,'registration');if(!expectedChallenge)return res.status(400).json({error:'Enrollment challenge expired.'});
 const verification=await verifyRegistrationResponse({response:req.body.response,expectedChallenge,expectedOrigin:ORIGINS,expectedRPID:RP_ID,requireUserVerification:true});
 if(!verification.verified)return res.status(401).json({error:'Passkey verification failed.'});
 const r=verification.registrationInfo;await AdminPasskey.create({username:USERNAME,credentialID:r.credential.id,publicKey:b64u(r.credential.publicKey),counter:r.credential.counter,transports:r.credential.transports||req.body.response.response.transports||[]});
 const user=await adminUser();res.json({verified:true,token:generateToken(user),username:'AdminXYZ',isAdmin:true});
 }catch(e){console.error('[admin-passkey/register]',e.message);res.status(400).json({error:'Passkey enrollment failed.'});}
});
router.post('/login/options',async(req,res)=>{
 if(String(req.body.username||'').toLowerCase()!==USERNAME)return res.status(404).json({error:'Admin not found.'});
 const creds=await AdminPasskey.find({username:USERNAME});if(!creds.length)return res.status(409).json({error:'Admin passkey is not configured.'});
 const options=await generateAuthenticationOptions({rpID:RP_ID,userVerification:'required',allowCredentials:creds.map(x=>({id:x.credentialID,transports:x.transports}))});
 const key=crypto.randomUUID();await saveChallenge(key,options.challenge,'authentication');res.json({key,options});
});
router.post('/login/verify',async(req,res)=>{
 try{const expectedChallenge=await takeChallenge(req.body.key,'authentication');if(!expectedChallenge)return res.status(400).json({error:'Login challenge expired.'});
 const c=await AdminPasskey.findOne({credentialID:req.body.response.id,username:USERNAME});if(!c)return res.status(401).json({error:'Unknown passkey.'});
 const verification=await verifyAuthenticationResponse({response:req.body.response,expectedChallenge,expectedOrigin:ORIGINS,expectedRPID:RP_ID,credential:{id:c.credentialID,publicKey:from64(c.publicKey),counter:c.counter,transports:c.transports},requireUserVerification:true});
 if(!verification.verified)return res.status(401).json({error:'Passkey verification failed.'});
 c.counter=verification.authenticationInfo.newCounter;c.lastUsedAt=new Date();await c.save();const user=await adminUser();if(!user)return res.status(403).json({error:'Admin account unavailable.'});
 res.json({verified:true,token:generateToken(user),username:'AdminXYZ',isAdmin:true});
 }catch(e){console.error('[admin-passkey/login]',e.message);res.status(401).json({error:'Passkey login failed.'});}
});
module.exports=router;
