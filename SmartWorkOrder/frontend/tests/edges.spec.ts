import { test, expect, type Page } from '@playwright/test'
async function login(page:Page, role='员工') { await page.goto('/'); await page.getByRole('button',{name:role,exact:true}).click(); await page.getByRole('button',{name:'登录',exact:true}).click(); await expect(page.getByRole('heading',{name:/你好/})).toBeVisible(); await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0) }
async function go(page:Page,path:string) { await page.evaluate(async path=>{const app=(document.getElementById('app') as unknown as {__vue_app__:{config:{globalProperties:{$router:{push(path:string):Promise<unknown>}}}}}).__vue_app__;await app.config.globalProperties.$router.push(path)},path) }
test('身份切换刷新数据、平板布局与登录刷新',async({page})=>{
  await login(page);await expect(page.getByText('共 6 个工单')).toBeVisible()
  await page.getByRole('button',{name:'切换身份'}).hover();await page.getByRole('menuitem',{name:'处理人员 · 陈嘉'}).click();await expect(page.getByText('部门待处理',{exact:true})).toBeVisible();await expect(page.getByText('共 2 个工单')).toBeVisible()
  await page.setViewportSize({width:768,height:1024});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
  await page.reload();await expect(page.getByRole('heading',{name:'登录工作空间'})).toBeVisible()
})
test('重复请求、竞争领取与非法访问',async({page})=>{
  await login(page)
  const result=await page.evaluate(async()=>{
    async function request(method:string,path:string,body?:unknown,token?:string){const res=await fetch(path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,...await res.json()}}
    const employee=(await request('POST','/api/auth/login',{username:'employee',password:'Demo123!'})).data.accessToken
    const handler=(await request('POST','/api/auth/login',{username:'handler',password:'Demo123!'})).data.accessToken
    const admin=(await request('POST','/api/auth/login',{username:'admin',password:'Demo123!'})).data.accessToken
    const requestId=crypto.randomUUID(),body={title:'边界验收',description:'验证幂等和领取',categoryId:'c-it',priority:'MEDIUM',requestId}
    const first=await request('POST','/api/tickets',body,employee),second=await request('POST','/api/tickets',body,employee)
    const attempts=await Promise.all([request('POST',`/api/tickets/${first.data.id}/claim`,{version:1},handler),request('POST',`/api/tickets/${first.data.id}/claim`,{version:1},handler)])
    const foreign=await request('GET','/api/tickets/t-7',undefined,employee),closed=await request('POST','/api/tickets/t-4/comments',{content:'不能发送'},employee),lastAdmin=await request('PUT','/api/users/u-admin/status',{status:'DISABLED',version:1},admin),department=await request('PUT','/api/departments/dep-it/status',{status:'DISABLED',version:1},admin)
    return {first:first.data.id,second:second.data.id,attempts:attempts.map(x=>x.status).sort(),foreign:{status:foreign.status,body:foreign.message},closed:closed.status,lastAdmin:lastAdmin.status,department:department.status}
  })
  expect(result.first).toBe(result.second);expect(result.attempts).toEqual([200,409]);expect(result.foreign.status,JSON.stringify(result)).toBe(403);expect(result.closed).toBe(403);expect(result.lastAdmin).toBe(409);expect(result.department).toBe(409)
})
test('流式回答停止、反馈与会话删除',async({page})=>{
  await login(page);await go(page,'/assistant/knowledge');await page.locator('textarea').fill('办公 VPN 连接');await page.getByRole('button',{name:'发送',exact:true}).click();await page.getByRole('button',{name:'停止生成',exact:true}).click();await expect(page.getByText('已停止',{exact:true}).first()).toBeVisible()
  await page.locator('textarea').fill('办公 VPN 连接');await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.getByText('已完成',{exact:true}).first()).toBeVisible({timeout:20000})
  await page.getByRole('button',{name:'评价回答'}).click();const feedback=page.getByRole('dialog');await expect(feedback).toBeVisible();await feedback.getByRole('button',{name:'取消'}).click()
  await page.getByRole('button',{name:/删除会话：/}).click();await page.getByRole('dialog').getByRole('button',{name:'删除',exact:true}).click();await expect(page.getByText('还没有会话',{exact:true})).toBeVisible()
})
test('AI失败不影响提单与404状态',async({page})=>{
  await login(page);await go(page,'/tickets/new');await page.getByPlaceholder('用一句话说明你遇到的问题').fill('服务暂不可用时提单');await page.locator('textarea').fill('即使AI失败仍然允许正常提交。')
  await page.evaluate(async()=>{const resource=performance.getEntriesByType('resource').map(entry=>entry.name).filter(name=>new URL(name).pathname==='/src/mocks/browser.ts').at(-1);if(!resource)throw new Error('未找到当前演示模块');const {worker}=await import(resource);const {http,HttpResponse}=await import('/node_modules/.vite/deps/msw.js');worker.use(http.post('/api/tickets/ai-suggestions',()=>HttpResponse.json({code:503,message:'AI 服务暂不可用',data:null},{status:503})))})
  await page.getByRole('button',{name:'建议分类与优先级'}).click();await expect(page.getByText('AI 服务暂不可用',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'提交工单',exact:true})).toBeEnabled()
  await go(page,'/tickets/not-found');await expect(page.getByText('内容不存在或已不可用',{exact:true})).toBeVisible()
})
