/** Drive the actual current visible UI; never dispatch hidden actions or edit DOM. */
export async function workspace(page,id){
 const current=page.locator('.ares-app[data-workspace]');
 if(await current.getAttribute('data-workspace')!==id)await page.locator('.galaxy-nav [data-action=workspace][data-id="'+id+'"]').click();
}
export async function settings(page){
 await workspace(page,'projects');
 const panel=page.locator('.galaxy-console');
 await (await panel.isVisible()?panel:page).locator('[data-action=project-settings]').filter({visible:true}).first().click();
 await page.getByRole('dialog').waitFor();
}
export async function advanced(page){
 await settings(page);const dialog=page.getByRole('dialog'),summary=dialog.locator('summary').filter({hasText:'维护与高级配置'});
 if(!await summary.evaluate(node=>node.parentElement.open))await summary.click();return dialog;
}
export async function flowLibrary(page){const dialog=await advanced(page);await dialog.locator('[data-action=workflow-library]').click();await page.getByLabel('步骤名称',{exact:true}).waitFor();}
export async function capabilities(page){await flowLibrary(page);const dialog=await advanced(page);await dialog.locator('[data-action=page][data-id=skills]').click();await page.locator('.galaxy-console[data-galaxy-panel=skills]').waitFor();}
export async function motion(page){const dialog=await advanced(page);await dialog.locator('[data-action=motion-toggle]').click();await dialog.getByRole('button',{name:'关闭对话框',exact:true}).click();}
export async function home(page){const panel=page.locator('.galaxy-console');if(await panel.isVisible())await panel.locator('[data-action=galaxy-home]').filter({visible:true}).first().click();}
export async function competitionDirectory(page){await workspace(page,'composer');await page.locator('[data-action=directory-open]').click();await page.getByRole('dialog').waitFor();}
export async function projectPicker(page){
 await workspace(page,'projects');
 await home(page);
 await page.locator('[data-action=galaxy-projects]').filter({visible:true}).first().click();
 await page.locator('.galaxy-console[data-galaxy-panel=projects]').waitFor();
}
export async function projectFlow(page){
 await settings(page);
 await page.getByRole('dialog').locator('[data-action=page][data-id=studio]').click();
 await page.getByLabel('步骤名称',{exact:true}).waitFor();
}
export async function projectTab(page,id){
 if(id==='progress'){await workspace(page,'projects');const panel=page.locator('.galaxy-console');if(await panel.isVisible())await panel.locator('[data-action=galaxy-home]').filter({visible:true}).first().click();await page.locator('[data-action=project-tab][data-id=progress]').filter({visible:true}).first().click();return;}
 await settings(page);await page.getByRole('dialog').locator('[data-action=project-tab][data-id="'+id+'"]').click();
}
export async function refresh(page){
 await settings(page);
 const dialog=page.getByRole('dialog'),summary=dialog.locator('summary').filter({hasText:'维护与高级配置'});
 if(!await summary.evaluate(node=>node.parentElement.open))await summary.click();
 await dialog.locator('[data-action=refresh]').click();
 await dialog.waitFor({state:'detached'});
}
export async function selectStage(page,id){
 await workspace(page,'projects');
 await page.locator('.ares-ui-pending').waitFor({state:'hidden'});
 const label=page.locator('.reference-stage-actors .process-step[data-id="'+id+'"]');
 if(!await label.isVisible()){
  const previous=page.getByRole('button',{name:'上一组阶段',exact:true});
  for(let index=0;index<20&&await previous.isVisible()&&await previous.isEnabled();index++)await previous.click();
  const next=page.getByRole('button',{name:'下一组阶段',exact:true});
  for(let index=0;index<20&&!await label.isVisible()&&await next.isVisible()&&await next.isEnabled();index++)await next.click();
 }
 // The reference nodes keep moving. Keyboard activation exercises the real
 // accessible button without bypassing hit-testing or waiting for a still node.
 await label.press('Enter');
 await page.locator('[data-neural-focus]').waitFor({state:'visible'});
}
export async function nodeDetails(page,id){
 await selectStage(page,id);
 await page.locator('[data-neural-focus] [data-action=nebula-node-open]').click();
 await page.getByRole('dialog').waitFor();
}
export async function selectArtifact(page,stepId,artifactId){
 await selectStage(page,stepId);
 await page.locator('.neural-output[data-id="'+artifactId+'"]').filter({visible:true}).press('Enter');
 await page.locator('.work-artifact').waitFor({state:'visible'});
}
