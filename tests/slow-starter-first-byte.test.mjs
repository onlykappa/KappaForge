import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const registry=JSON.parse(readFileSync(new URL('../config/providers.json',import.meta.url),'utf8'));
const router=readFileSync(new URL('../chat-backend/src/inference-router.js',import.meta.url),'utf8');

test('NVIDIA gets longer than its measured 25s slow start before it is called silent',()=>{
 const wait=registry.providers.nvidia.firstByteMs;
 assert.ok(wait>25000,'strong NVIDIA models measured over 25s to their first token');
 assert.ok(wait<=registry.routing.defaults.attemptTimeoutMs,'the attempt limit still ends a silent route');
});

test('only providers that ask for it get the longer wait',()=>{
 const asking=Object.entries(registry.providers).filter(([,p])=>p.firstByteMs).map(([id])=>id);
 assert.deepEqual(asking,['nvidia']);
});

test('the router reads the provider wait and never exceeds the attempt limit',()=>{
 assert.match(router,/Math\.min\(Number\(p\.firstByteMs\)\|\|FIRST_BYTE_MS,registry\.routing\.defaults\.attemptTimeoutMs\)/);
});
