import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const page=fs.readFileSync(path.join(root,'nira.html'),'utf8');
const script=fs.readFileSync(path.join(root,'nira.js'),'utf8');
const css=fs.readFileSync(path.join(root,'nira.css'),'utf8');
const ids=[...page.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.equal(new Set(ids).size,ids.length,'DOM IDs must be unique');
for(const key of ['socialStats','npcRelations','npcBeliefs','socialFeed','npcEvents','simLoad','simSave','simImportFile','simToggle','simHour','simDay']){
  assert.ok(ids.includes(key),`missing UI element ${key}`);
  assert.ok(script.includes(`'${key}'`),`missing R2 JS binding ${key}`);
}
assert.ok(page.includes('R2 · Living Society'));
assert.ok(script.includes('nira-r1-world-save-v1'),'legacy save migration must remain');
assert.ok(script.includes('nira-r2-world-save-v1'),'R2 save key must be present');
assert.ok(script.includes('textContent'),'untrusted text must render as text');
assert.ok(!script.includes('innerHTML'),'do not render report content as HTML');
assert.ok(css.includes('.social-section'));
console.log('PASS R2 static page contract; browser visual QA requires separate execution');
