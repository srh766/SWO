import { test, expect, type Page } from '@playwright/test'
async function login(page: Page, role='员工') { await page.goto('/'); await page.getByRole('button',{name:role,exact:true}).click(); await page.getByRole('button',{name:'登录',exact:true}).click(); await expect(page.getByRole('heading',{name:/你好/})).toBeVisible() }
async function switchRole(page: Page, role: string) { await page.getByRole('button',{name:'切换身份'}).hover(); await page.getByRole('menuitem',{name:role}).click(); await expect(page.getByRole('heading',{name:/你好/})).toBeVisible() }
async function go(page: Page, path:string) { await page.evaluate(async path => { const app = (document.getElementById('app') as unknown as { __vue_app__: { config: { globalProperties: { $router: { push(path:string):Promise<unknown> } } } } }).__vue_app__; await app.config.globalProperties.$router.push(path) },path) }
test('工单闭环、知识审核、权限与响应式',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  await login(page)
  await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0)
  await page.screenshot({path:'test-results/workbench.png',fullPage:true})
  await page.getByRole('link',{name:'创建工单'}).first().click()
  await page.getByPlaceholder('用一句话说明你遇到的问题').fill('验收：办公账号无法访问')
  await page.getByPlaceholder('发生了什么？影响哪些工作？你已经尝试过哪些方法？').fill('登录后提示没有权限，已经尝试退出重登。需要访问日报模块。')
  await page.getByRole('button',{name:'建议分类与优先级'}).click()
  await page.getByRole('button',{name:'采用建议'}).click()
  await page.getByRole('button',{name:'提交工单',exact:true}).click()
  await expect(page.getByRole('heading',{name:'验收：办公账号无法访问'})).toBeVisible()
  const ticketPath=new URL(page.url()).pathname
  await switchRole(page,'处理人员 · 陈嘉');await go(page,ticketPath)
  await page.getByRole('button',{name:'领取工单',exact:true}).click();await expect(page.getByText('处理中',{exact:true}).first()).toBeVisible()
  await page.getByPlaceholder('补充问题信息，或与同事沟通处理进展').fill('已检查权限配置，准备修复。');await page.getByRole('button',{name:'发送评论'}).click();await expect(page.getByText('已检查权限配置，准备修复。',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'标记已解决'}).click();await page.getByRole('dialog').locator('textarea').fill('已补齐权限并验证正常，请重新登录后确认。');await page.getByRole('button',{name:'确认提交'}).click();await expect(page.getByText('已解决',{exact:true}).first()).toBeVisible()
  await page.getByRole('button',{name:'转为知识草稿'}).click();await page.getByRole('button',{name:'创建知识草稿',exact:true}).click();await expect(page.getByRole('button',{name:'提交审核',exact:true})).toBeVisible()
  const articlePath=new URL(page.url()).pathname
  await page.getByRole('button',{name:'提交审核',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认',exact:true}).click();await expect(page.getByText('待审核',{exact:true}).first()).toBeVisible()
  await switchRole(page,'管理员 · 周宁');await go(page,articlePath);await page.getByRole('button',{name:'批准发布'}).click();await page.getByRole('dialog').getByRole('button',{name:'确认',exact:true}).click();await expect(page.getByText('已发布',{exact:true}).first()).toBeVisible()
  await switchRole(page,'员工 · 林晓');await go(page,ticketPath);await page.getByRole('button',{name:'确认关闭',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认关闭',exact:true}).click();await expect(page.getByText('已关闭',{exact:true}).first()).toBeVisible();await expect(page.getByRole('button',{name:'发送评论'})).toHaveCount(0)
  await go(page,'/admin/users');await expect(page.getByRole('heading',{name:'403'})).toBeVisible()
  await go(page,articlePath);await expect(page.getByRole('heading',{name:'验收：办公账号无法访问'})).toBeVisible()
  await page.setViewportSize({width:390,height:844});await go(page,'/workbench');await expect(page.getByRole('heading',{name:/你好/})).toBeVisible();await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);await page.screenshot({path:'test-results/mobile.png',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
  expect(errors).toEqual([])
})
test('问答、Agent确认与会话历史',async({page})=>{
  await login(page);await go(page,'/assistant/knowledge')
  await page.locator('textarea').fill('办公 VPN 连接');await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.getByText('已完成',{exact:true}).first()).toBeVisible({timeout:20000})
  await expect(page.getByText('以下为演示回答',{exact:false}).first()).toBeVisible()
  await go(page,'/assistant/agent');await page.locator('textarea').fill('帮我创建工单，办公网络无法访问');await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.getByRole('button',{name:/确认创建/})).toBeVisible({timeout:20000});await page.getByRole('button',{name:/确认创建/}).click();await expect(page.getByText('已创建工单',{exact:true}).first()).toBeVisible()
  await page.screenshot({path:'test-results/assistant.png',fullPage:true})
})
test('管理员组织操作与文件上传下载',async({page})=>{
  await login(page,'管理员');await go(page,'/admin/departments');await page.getByRole('button',{name:'新建部门'}).click();const dialog=page.getByRole('dialog');await dialog.locator('input').nth(0).fill('验收部门');await dialog.locator('input').nth(1).fill('QA');await dialog.getByRole('button',{name:'确认保存'}).click();await expect(page.getByText('验收部门',{exact:true})).toBeVisible()
  await go(page,'/knowledge/documents/new');await page.locator('input[type=file]').first().setInputFiles({name:'验收指引.md',mimeType:'text/markdown',buffer:Buffer.from('# 验收指引\n\n这是可受控下载的知识文档。')});await page.getByRole('button',{name:'保存草稿'}).click();await expect(page.getByRole('button',{name:'下载原文件'})).toBeVisible();const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'下载原文件'}).click();expect((await downloaded).suggestedFilename()).toBe('验收指引.md')
  await go(page,'/stats/tickets');await expect(page.getByRole('heading',{name:'状态分布'})).toBeVisible();await go(page,'/stats/ai');await expect(page.getByRole('heading',{name:'调用明细'})).toBeVisible()
})
