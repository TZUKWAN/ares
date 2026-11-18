export const html=value=>String(value??'').replace(/[&<>"']/g,key=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[key]));
export const button=(action,label,{data={},disabled=false,primary=false,type='button'}={})=>
  '<button type="'+type+'" class="research-button'+(primary?' is-primary':'')+'" data-r="'+action+'"'+(disabled?' disabled':'')+
  Object.entries(data).map(([key,value])=>' data-'+key+'="'+html(value)+'"').join('')+'>'+html(label)+'</button>';
export const option=(value,label,selected=false)=>'<option value="'+html(value)+'"'+(selected?' selected':'')+'>'+html(label)+'</option>';
export const field=(label,control)=>{
  const named=control.includes('aria-label=')?control:control.replace(/^<(input|select|textarea)\b/,'<$1 aria-label="'+html(label)+'"');
  return '<label class="research-field"><span>'+html(label)+'</span>'+named+'</label>';
 };
export const input=(name,value='',attrs='')=>'<input name="'+html(name)+'" value="'+html(value)+'" '+attrs+'>';
export const area=(name,value='',attrs='')=>'<textarea name="'+html(name)+'" rows="3" '+attrs+'>'+html(value)+'</textarea>';
export const select=(name,options,attrs='')=>'<select name="'+html(name)+'" '+attrs+'>'+options+'</select>';
export const empty=(text)=>'<p class="research-empty">'+html(text)+'</p>';
export const heading=(title,detail='',actions='')=>'<header class="research-heading"><div><h3>'+html(title)+'</h3>'+(detail?'<p>'+html(detail)+'</p>':'')+'</div><div class="research-actions">'+actions+'</div></header>';
export const dataLink=(path,data)=>'/ares/api/v2/research/'+path+'?'+new URLSearchParams(data);
export const names={survey:'问卷',guide:'访谈提纲',interview:'访谈记录',codebook:'编码本',responses:'实际答卷',pretest:'模拟预测试',dataset:'数据集',report:'研究报告'};
export const levels={draft:'草稿',proposal:'待采用',template:'模板',final:'已定稿','owner-attested':'负责人登记',completed:'已完成',failed:'失败',cancelled:'已取消'};
export const badge=value=>'<span class="research-chip" data-state="'+html(value)+'">'+html(levels[value]??value)+'</span>';
