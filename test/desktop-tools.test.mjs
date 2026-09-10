import test from 'node:test';
import assert from 'node:assert/strict';
import {desktopTools,callDesktopTool} from '../src/desktop-tools.mjs';
import {inputValidator} from '../src/gateway-core.mjs';

test('desktop helpers plan one atomic sequence and preserve returned screenshot',async()=>{
  const args=inputValidator(desktopTools[0].inputSchema)({});
  let steps;
  const result=await callDesktopTool('fecimus_desktop_state',args,async planned=>{
    steps=planned;
    return {completed:4,stopped:false,results:planned.map(s=>({tool:s.tool,result:{content:s.tool==='desktop_screenshot'?[{type:'image',mimeType:'image/png',data:'fixture'}]:[{type:'text',text:'{"ok":true}'}]}}))};
  });
  assert.deepEqual(steps.map(s=>s.tool),['window_list','window_active','desktop_screen_info','desktop_screenshot']);
  assert.equal(result.content[1].data,'fixture');
  assert.equal(JSON.parse(result.content[0].text).completed,4);
});
test('action schema rejects arbitrary tools and helper reports stopped actions honestly',async()=>{
  const validate=inputValidator(desktopTools[1].inputSchema);
  assert.throws(()=>validate({steps:[{tool:'shell_run'}]}));
  assert.throws(()=>validate({steps:[]}));
  const args=validate({steps:[{tool:'mouse_click'}],screenshot:false});
  let steps;
  const result=await callDesktopTool('fecimus_desktop_actions',args,async planned=>{
    steps=planned;return {completed:0,failed_step:0,stopped:true,results:[{tool:'mouse_click',result:{isError:true,content:[{type:'text',text:'May have run; no replay.'}]}}]};
  });
  assert.equal(steps.length,1);assert.deepEqual(steps[0].arguments,{});
  assert(result.isError);assert.equal(JSON.parse(result.content[0].text).failed_step,0);
});
