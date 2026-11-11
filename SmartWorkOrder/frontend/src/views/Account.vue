<script setup lang="ts">
import { reactive, ref } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import { useAuth } from '../stores/auth'
import { api } from '../api'
import { notifyError } from '../utils'
const auth = useAuth(), router = useRouter(), busy = ref(false), formRef = ref<FormInstance>()
const form = reactive({ oldPassword: '', newPassword: '', confirm: '' })
const rules: FormRules = { oldPassword: [{ required: true, message: '请输入当前密码' }], newPassword: [{ required: true, min: 8, max: 72, message: '新密码应为 8–72 个字符' }], confirm: [{ validator: (_rule, value, callback) => value === form.newPassword ? callback() : callback(new Error('两次输入的密码不一致')) }] }
async function save() { if (!await formRef.value?.validate().catch(() => false)) return; busy.value = true; try { await api('PUT', '/api/auth/password', { oldPassword: form.oldPassword, newPassword: form.newPassword }); auth.clear(); ElMessage.success('密码已修改，请重新登录'); await router.replace('/login') } catch (e) { notifyError(e) } finally { busy.value = false } }
</script><template><div class="page"><div class="page-header"><div><h1>个人账号</h1><p class="subtitle">查看你的企业身份，管理登录密码。</p></div></div><div class="detail-grid"><section class="surface"><h2>账号信息</h2><dl class="key-value"><dt>姓名</dt><dd>{{ auth.user?.name }}</dd><dt>用户名</dt><dd>{{ auth.user?.username }}</dd><dt>所属部门</dt><dd>{{ auth.user?.department?.name }}</dd><dt>角色</dt><dd>{{ auth.user?.roles.map(r => r.name).join('、') }}</dd></dl><hr class="section-rule"><p class="muted">如需变更资料、部门或角色，请联系管理员。</p></section><section class="surface"><h2>修改密码</h2><el-form ref="formRef" :rules="rules" :model="form" label-position="top" @submit.prevent="save"><el-form-item label="当前密码" prop="oldPassword"><el-input v-model="form.oldPassword" type="password" show-password autocomplete="current-password"/></el-form-item><el-form-item label="新密码" prop="newPassword"><el-input v-model="form.newPassword" type="password" show-password autocomplete="new-password"/></el-form-item><el-form-item label="确认新密码" prop="confirm"><el-input v-model="form.confirm" type="password" show-password autocomplete="new-password"/></el-form-item><el-button type="primary" :loading="busy" native-type="submit">保存新密码</el-button></el-form><p class="form-help">修改后现有登录凭据失效，需要重新登录。</p></section></div></div></template>
