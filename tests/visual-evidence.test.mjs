import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {compareRGBA}=createRequire(import.meta.url)('../tools/visual-evidence.cjs');
test('pixel comparison reports exact counts, tolerance and changed dimensions',()=>{
 const image=data=>({width:2,height:1,data});
 const a=image([0,0,0,255,0,0,0,255]),b=image([4,4,4,255,30,0,0,255]);
 assert.deepEqual(compareRGBA(a,b,{maxChannelDelta:8,maxDifferentRatio:.5}),{status:'passed',differentPixels:1,totalPixels:2,differentRatio:.5,maxChannelDelta:8,maxDifferentRatio:.5});
 assert.equal(compareRGBA(a,b,{maxChannelDelta:8,maxDifferentRatio:0}).status,'failed');
 assert.equal(compareRGBA(a,{...b,width:1}).reason,'Image dimensions differ');
 assert.throws(()=>compareRGBA(a,b,{maxDifferentRatio:NaN}),/tolerance/);
 assert.throws(()=>compareRGBA(a,{...b,data:[]}),/pixel data/);
});
