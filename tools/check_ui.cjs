// Optional browser regression check, separate from the offline Python grader.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const origin=process.argv[2] || 'http://127.0.0.1:8000/';
async function check(page, width) {
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin);
  const byButton=name=>page.getByRole('button',{name,exact:true});
  const sheetClosed=()=>page.locator('#sheet').waitFor({state:'hidden'});
  const close=async()=>{await byButton('Закрыть').click();await sheetClosed();};
  async function openScreen(key){
    if(width<=760){
      if(['audit','balance','dossier'].includes(key))await page.locator('#dock [data-screen="'+key+'"]').click();
      else {await byButton('Ещё').click();await page.locator('#sheet [data-screen="'+key+'"]').click();}
    }else await page.locator('#nav [data-screen="'+key+'"]').click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,key+' overflow');
  }
  await byButton('Открыть платёж').click();
  assert.match(await page.locator('#sheet-body').innerText(),/PAY-042/);
  await close();await byButton('Следующий шаг').click();await byButton('Открыть проводку').click();
  await byButton('Сопоставить с платежом').click();
  assert.match((await page.locator('#sheet-body').innerText()).replaceAll(/\s/g,''),/20000/);
  await page.goBack();await sheetClosed();
  await byButton('Следующий шаг').click();await byButton('Посмотреть расчёт').click();await close();
  await byButton('Следующий шаг').click();await byButton('Открыть итог').click();
  assert.match(await page.locator('#sheet-body').innerText(),/0,984/);await close();
  assert(await byButton('Следующий шаг').isDisabled());
  await openScreen('balance');await byButton('Проводки').click();await page.locator('[data-ab-doc="L-102"]').click();await close();
  await byButton('Показать расчёт').click();await close();
  await openScreen('dossier');for(const folder of ['payments','ledger','invoices']){await page.locator('[data-folder="'+folder+'"]').click();await page.locator('[data-record]').first().click();await close();}
  await page.locator('[data-finding]').click();await page.locator('#sheet [data-source]').first().click();await close();
  await openScreen('period');await byButton('UTC').click();assert.match(await page.locator('[data-boundary]').innerText(),/19:00/);
  await page.locator('[data-period-record="PAY-088"]').click();await close();await page.locator('[data-policy]').click();await close();
  await openScreen('pair');await byButton('Повтор Б').click();assert.match(await page.locator('.pr-records').innerText(),/INV-/);
  await page.locator('[data-normalize]').click();await close();
  await openScreen('reward');await byButton('С повтором').click();assert.equal(await page.locator('[data-score]').innerText(),'0,317');
  await page.locator('[data-formula]').click();await close();
  await openScreen('lab');await byButton('Dev').click();await page.locator('select[data-episode]').selectOption('dev-08');
  await page.locator('select[data-policy]').selectOption('reconcile');await page.locator('[data-controls]').waitFor({state:'visible'});
  await page.locator('[data-next]').click();await page.locator('[data-preview="observation"]').click();await page.locator('[data-json]').click();
  assert.match(await page.locator('#sheet-body').innerText(),/remaining_steps/);await close();
  await page.locator('[data-compare]').click();await close();
  await page.locator('select[data-policy]').selectOption('oracle');await page.waitForFunction(()=>document.querySelector('[data-position]').textContent==='1 из 1');
  assert(await page.locator('[data-next]').isDisabled());
  const data=await page.request.get(new URL('downloads/benchmark.json',origin).href);
  assert.equal(data.status(),200);assert.equal((await data.json()).pairs,20);
  await openScreen('audit');assert.match(await page.locator('[data-ab-meta]').innerText(),/9/);
  assert.deepEqual(errors,[]);console.log(width+'px: seven views, history, evidence, controls, JSONL and benchmark OK');
}
(async()=>{
  const browser=await chromium.launch({channel:process.env.CHROME_CHANNEL||'chrome',headless:true});
  try {for(const width of [320,390,820,1360]){const page=await browser.newPage({viewport:{width,height:844},reducedMotion:width===320?'reduce':'no-preference'});try{await check(page,width);}finally{await page.close();}}}
  finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
