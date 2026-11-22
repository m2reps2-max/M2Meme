'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
function firstNonEmpty(...values){for(const value of values)if(typeof value==='string'&&value.trim())return value.trim();return '';}
function readOrCreateSessionSecret(dataDir){
 const file=path.join(dataDir,'session-secret.key');
 try{const existing=fs.readFileSync(file,'utf8').trim();if(existing.length<32)throw new Error('Le secret de session persistant est invalide : data/session-secret.key doit contenir au moins 32 caractères.');return existing;}
 catch(error){if(error.code!=='ENOENT')throw error;}
 fs.mkdirSync(dataDir,{recursive:true,mode:0o700});
 const generated=crypto.randomBytes(48).toString('base64url');
 try{fs.writeFileSync(file,generated+'\n',{encoding:'utf8',flag:'wx',mode:0o600});return generated;}
 catch(error){if(error.code!=='EEXIST')throw error;const existing=fs.readFileSync(file,'utf8').trim();if(existing.length<32)throw new Error('Le secret de session persistant est invalide : data/session-secret.key doit contenir au moins 32 caractères.');return existing;}
}
function resolveDashboardConfig({env=process.env,dataDir=path.join(process.cwd(),'data')}={}){
 const accessCode=firstNonEmpty(env.DASHBOARD_ACCESS_CODE,env.DASHBOARD_PASSWORD);
 if(!accessCode)throw new Error('Configuration manquante : définis DASHBOARD_ACCESS_CODE (ou DASHBOARD_PASSWORD pour compatibilité).');
 const suppliedSecret=firstNonEmpty(env.DASHBOARD_SESSION_SECRET);
 if(suppliedSecret&&suppliedSecret.length<32)throw new Error('DASHBOARD_SESSION_SECRET doit contenir au moins 32 caractères.');
 const sessionSecret=suppliedSecret||readOrCreateSessionSecret(dataDir);
 const portRaw=firstNonEmpty(env.PORT)||'8080',port=Number(portRaw);
 if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT doit être un entier compris entre 1 et 65535.');
 const dashboardUrl=firstNonEmpty(env.DASHBOARD_URL).replace(/\/$/,'');
 const production=!['development','test'].includes(String(env.NODE_ENV||'').toLowerCase());
 if(dashboardUrl){let parsed;try{parsed=new URL(dashboardUrl);}catch{throw new Error('DASHBOARD_URL doit être une URL absolue valide.');}if(production&&parsed.protocol!=='https:')throw new Error('DASHBOARD_URL doit utiliser HTTPS en production.');}
 return {accessCode,sessionSecret,dashboardUrl,port,production,sessionSecretSource:suppliedSecret?'environment':'persistent_file'};
}
module.exports={resolveDashboardConfig,readOrCreateSessionSecret};
