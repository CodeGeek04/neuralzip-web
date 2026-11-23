// Run after NEXT_PUBLIC_BASE_PATH=/neuralzip npm run build.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = process.env.NEXT_PUBLIC_BASE_PATH || '/neuralzip';
const origin = 'http://127.0.0.1:4174';
const server = spawn(process.execPath, ['scripts/serve.mjs','--port','4174'], {env:{...process.env,NEXT_PUBLIC_BASE_PATH:base},stdio:'pipe'});
let browser;
try {
  await new Promise((resolve,reject) => { server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code => reject(new Error('Static server exited: '+code))); });
  browser = await chromium.launch({channel:'chrome',args:['--use-angle=swiftshader','--enable-webgl','--enable-unsafe-swiftshader']});
  const page = await browser.newPage();
  const failed=[];page.on('requestfailed',r=>failed.push(r.url()));
  page.on('response',r=>{if(r.status()>=400)failed.push(r.status()+' '+r.url());});
  await page.goto(origin+base+'/');
  await page.locator('#file-input').setInputFiles({name:'path.txt',mimeType:'text/plain',buffer:Buffer.from('A model under a subdirectory.\r\n')});
  await page.getByRole('button',{name:'Encode file',exact:true}).click();
  await page.locator('#output-result').waitFor({timeout:300000});
  const downloadPromise=page.waitForEvent('download');await page.locator('#download-button').click();
  const download=await downloadPromise;const archive=await readFile(await download.path());
  assert.equal(archive.subarray(0,8).toString(),'NEURZIP1');
  await page.locator('#file-input').setInputFiles({name:'path.txt.nzip',mimeType:'application/octet-stream',buffer:archive});
  await page.getByRole('button',{name:'Decode archive',exact:true}).click();
  await page.locator('#output-result').waitFor({timeout:30000});
  const restoredPromise=page.waitForEvent('download');await page.locator('#download-button').click();
  const restored=await restoredPromise;
  assert.equal((await readFile(await restored.path())).toString(),'A model under a subdirectory.\r\n');
  for(const file of ['docs/','benchmarks/','downloads/neuralzip-0.3.1-py3-none-any.whl','downloads/neuralzip-0.3.1.tar.gz'])assert.ok((await page.request.get(origin+base+'/'+file)).ok(),file);
  assert.deepEqual(failed,[]);
  console.log('Subdirectory export: training, lazy chunks, worker decoding, exact restoration, pages and downloads passed.');
} finally {await browser?.close();server.kill('SIGTERM');}
