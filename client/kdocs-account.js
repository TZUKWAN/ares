/** Account access is global. A collaboration folder belongs to one project. */
export function createKdocsAccount({api,onChange,helpers:{e,button}}) {
  let status=null,login=null,loading=false,error='',timer=null,disposed=false,generation=0;
  const notify=()=>{if(!disposed)onChange();};
  async function refresh() {
    const current=++generation;
    loading=true;error='';notify();
    try {
      const result=await api('kdocs/account/status',{});
      if(!disposed&&current===generation)status=result;
    }catch(cause){if(current===generation)error=cause.message;}
    finally{if(current===generation){loading=false;notify();}}
  }
  async function poll() {
    try {
      const next=await api('kdocs/account/login/status');
      if(disposed)return;
      login=next;
      if(next.status==='completed') {status=next.account;notify();return;}
      if(!['authorizing','verifying'].includes(next.status)) {error=next.error||'';notify();return;}
      notify();timer=setTimeout(poll,2000);
    }catch(cause){error=cause.message;notify();}
  }
  async function startLogin() {
    clearTimeout(timer);error='';
    login=await api('kdocs/account/login',{confirmLogin:true});
    notify();timer=setTimeout(poll,600);
  }
  function view(project) {
    const connected=status?.connected===true,pending=['authorizing','verifying'].includes(login?.status);
    const label=loading?'正在检查金山认证':connected?'已认证 · 云目录可访问':status?.status==='login-required'?'需要认证金山账号':status?'金山连接需要处理':'尚未检查金山认证';
    const folder=project?.workbench?.collaboration;
    return `<section class="ares-kdocs-account" aria-label="金山账号与协作">
      <article class="ares-kdocs-account-card" data-kdocs-status="${e(status?.status||'unchecked')}">
        <span class="ares-kdocs-eyebrow">金山认证</span><h3>${e(label)}</h3>
        <p>ARES 使用本机金山账号，与金山网页授权及项目协作目录关联。</p>
        ${status?.checkedAt?`<p class="ares-help">检查于 ${e(new Date(status.checkedAt).toLocaleString())} · ${e(status.credentialStore||'金山 CLI')}</p>`:''}
        ${error||status?.error?`<p class="ares-alert" role="alert">${e(error||status.error)}</p>`:''}
        <div class="ares-actions">${button('kdocs-verify','检查连接','refresh','',loading?'disabled':'')}
          ${button('kdocs-login',connected?'重新认证金山账号':'登录并认证金山账号','link','primary',pending||loading||status?.installed===false?'disabled':'')}</div>
        ${pending?`<div class="ares-kdocs-auth" role="status"><strong>${login.status==='verifying'?'正在验证云目录访问':'请在金山授权页面完成认证'}</strong>
          ${login.url?`<a class="ares-btn" href="${e(login.url)}" target="_blank" rel="noopener noreferrer">打开本次金山授权</a>`:''}<p class="ares-help">认证完成后，ARES 会自动核对连接状态。</p></div>`:''}
      </article>
      <article class="ares-kdocs-account-card"><span class="ares-kdocs-eyebrow">项目协作</span>
        <h3>${project?.kind==='v2'?e(project.name):'选择项目后设置协作目录'}</h3>
        ${project?.kind==='v2'?`<p>${folder?.status==='connected'?'协作目录 · '+e(folder.folder?.name||'已连接金山目录'):'本项目尚未选择金山协作目录。'}</p>
          ${button('board-collaboration',folder?.status==='connected'?'管理金山工作稿':'选择金山协作目录','folder','',connected?'':'disabled')}`:
          `<p>每个项目单独选择共同编辑文档所在的文件夹。</p>${button('galaxy-projects','选择项目','folder','')}`}
      </article></section>`;
  }
  return {view,refresh,async handle(action){
    if(action==='kdocs-verify'){await refresh();return true;}
    if(action==='kdocs-login'){await startLogin();return true;}
    return false;
  },dispose(){disposed=true;generation++;clearTimeout(timer);}};
}
