'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {isTrustedDashboardRequest}=require('../lib/origin-guard');

test('accepts same-origin dashboard requests even when a reverse proxy rewrites internal host headers',()=>{
 assert.equal(isTrustedDashboardRequest({origin:'null',fetchSite:'same-origin',host:'internal:8080',protocol:'http'}),true);
});

test('rejects cross-site requests even if the Origin header resembles a configured dashboard URL',()=>{
 assert.equal(isTrustedDashboardRequest({origin:'https://dashboard.example.com',fetchSite:'cross-site',dashboardUrl:'https://dashboard.example.com'}),false);
});

test('accepts an exact public origin forwarded by FadeHost',()=>{
 assert.equal(isTrustedDashboardRequest({origin:'https://radar.example.com',fetchSite:'same-site',forwardedHost:'radar.example.com',forwardedProto:'https',host:'internal:8080',protocol:'http'}),true);
});

test('accepts a configured dashboard origin',()=>{
 assert.equal(isTrustedDashboardRequest({origin:'https://radar.example.com',dashboardUrl:'https://radar.example.com/app',host:'internal:8080',protocol:'http'}),true);
});

test('rejects unrelated and malformed origins when same-origin browser metadata is absent',()=>{
 assert.equal(isTrustedDashboardRequest({origin:'https://evil.example',fetchSite:'same-site',dashboardUrl:'https://radar.example.com',host:'radar.example.com',protocol:'https'}),false);
 assert.equal(isTrustedDashboardRequest({origin:'not-an-origin',fetchSite:'same-site',host:'radar.example.com',protocol:'https'}),false);
});
