'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {resolveDashboardConfig}=require('../lib/dashboard-config');

function temp(){return fs.mkdtempSync(path.join(os.tmpdir(),'meme-radar-config-'));}

test('legacy DASHBOARD_PASSWORD remains compatible and session secret is persisted across restarts',()=>{
 const dataDir=temp();
 const env={DASHBOARD_PASSWORD:'legacy-private-code',NODE_ENV:'production',PORT:'8080',DASHBOARD_URL:'https://m2meme.fadehost.app'};
 const first=resolveDashboardConfig({env,dataDir});
 const second=resolveDashboardConfig({env,dataDir});
 assert.equal(first.accessCode,'legacy-private-code');
 assert.equal(first.sessionSecretSource,'persistent_file');
 assert.equal(first.sessionSecret,second.sessionSecret);
 assert.ok(first.sessionSecret.length>=32);
 assert.equal(fs.statSync(path.join(dataDir,'session-secret.key')).mode&0o777,0o600);
});

test('preferred dashboard access code overrides the legacy alias',()=>{
 const config=resolveDashboardConfig({env:{DASHBOARD_ACCESS_CODE:'preferred',DASHBOARD_PASSWORD:'legacy',DASHBOARD_SESSION_SECRET:'x'.repeat(48),NODE_ENV:'test'},dataDir:temp()});
 assert.equal(config.accessCode,'preferred');
 assert.equal(config.sessionSecret,'x'.repeat(48));
 assert.equal(config.production,false);
});

test('invalid explicit session secrets fail instead of silently rotating credentials',()=>{
 assert.throws(()=>resolveDashboardConfig({env:{DASHBOARD_ACCESS_CODE:'private',DASHBOARD_SESSION_SECRET:'short'},dataDir:temp()}),/32 caractères/);
});

test('missing dashboard access code is reported clearly',()=>{
 assert.throws(()=>resolveDashboardConfig({env:{},dataDir:temp()}),/DASHBOARD_ACCESS_CODE.*DASHBOARD_PASSWORD/);
});

test('invalid ports and non-HTTPS production dashboard URLs are rejected',()=>{
 assert.throws(()=>resolveDashboardConfig({env:{DASHBOARD_ACCESS_CODE:'private',DASHBOARD_SESSION_SECRET:'x'.repeat(48),PORT:'not-a-port',NODE_ENV:'production'},dataDir:temp()}),/PORT doit/);
 assert.throws(()=>resolveDashboardConfig({env:{DASHBOARD_ACCESS_CODE:'private',DASHBOARD_SESSION_SECRET:'x'.repeat(48),DASHBOARD_URL:'http://example.com',NODE_ENV:'production'},dataDir:temp()}),/HTTPS/);
});

test('dashboard URL may be omitted when no Telegram deep link is required',()=>{
 const config=resolveDashboardConfig({env:{DASHBOARD_ACCESS_CODE:'private',DASHBOARD_SESSION_SECRET:'x'.repeat(48),NODE_ENV:'production'},dataDir:temp()});
 assert.equal(config.dashboardUrl,'');
});
