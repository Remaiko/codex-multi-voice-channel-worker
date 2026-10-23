import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('production entry point parses without starting gateways or requiring secrets',()=>{
 const result=spawnSync(process.execPath,['--check',fileURLToPath(new URL('../src/index.js',import.meta.url))],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
});
