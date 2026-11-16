# 子插件清单与真实预测试输入

这些是可复制的构建模板与模拟假设，不是已配置接口或真实问卷结果。实际接口地址、权限与输入约束应由使用者填写；ARES不会用模板内容冒充成功结果。

## 内置问卷：高级参数

在项目“问卷模型预测试 → 模型与高级题型 → 完整参数JSON”粘贴：

```json
{
  "count": 300,
  "seed": "pilot-assumptions-1",
  "scenario": "baseline",
  "missingRate": 0.03,
  "questions": [
    {"id":"Q1","label":"指标一（模拟假设）","type":"likert","levels":5,"factor":"quality","loading":0.8},
    {"id":"Q2","label":"指标二（模拟假设）","type":"likert","levels":5,"factor":"quality","loading":0.8},
    {"id":"Q3","label":"数值结果（模拟假设）","type":"numeric","mean":50,"std":10,"factor":"quality","loading":0.7},
    {"id":"group","label":"模拟分组","type":"categorical","categories":["A","B"],"probabilities":[0.5,0.5]},
    {"id":"choice","label":"模拟选择","type":"binary","probability":0.4}
  ],
  "model":{"target":"Q3","predictors":["Q1","Q2"]}
}
```

只有同一潜变量的量表/数值题共享设定因子，不同因子默认独立；二元和分类按显式概率独立抽样。参数是人为假设。目标模型可通过DSH原生工具读取实际预测试CSV并运行，结果仍属预测试。

## HTTPS接口清单的结构

基础表单生成有效清单；高级配置支持这些字段：

| 字段 | 含义 |
| --- | --- |
| `schema_version` | 当前为1 |
| `id`、`title`、`version` | 稳定标识、名称、具体语义版本，例如1.0.0 |
| `kind` | `http-json`、`native-tool`、内置`survey-generator` |
| `dataKind` | `synthetic`或`unverified`，外部接口不能自己声明真实采集已核验 |
| `inputSchema`、`outputSchema` | 有界JSON约束；支持type、required、properties、items、enum、数值/长度/数组范围、additionalProperties；不支持外部引用、代码和任意JSON Schema扩展 |
| `config.url`、`method` | HTTPS固定地址、GET或POST |
| `config.headerEnv` | 请求头名到本机环境变量名称的映射；值填写变量名而非密钥 |
| `config.responsePath` | 可选，例如`data.results`；只读取实际JSON自有字段与数组索引；路径不匹配、继承成员或超范围数值均失败 |

接口能力需真实服务和账号，不提供默认假问卷接口。构建后查看实际清单、启用权限、输入真实参数，再运行并查看回执。GET输入仅支持简单查询字段，复杂输入请使用POST。

## 经DSH运行自己的模型

```json
{
  "schema_version": 1,
  "id": "team-model-analysis",
  "title": "队内模型计算",
  "version": "1.0.0",
  "kind": "native-tool",
  "dataKind": "synthetic",
  "inputSchema": {
    "type": "object",
    "required": ["command"],
    "properties": {"command":{"type":"string","minLength":1,"maxLength":20000}},
    "additionalProperties": false
  },
  "config": {"tool":"pwsh","arguments":{"description":"运行团队实际模型，记录真实输出与退出结果"}}
}
```

该清单真实转发当前DSH可见的`pwsh`，没有内置模型或硬编码计算结果。负责人启用意味着允许此项目助手按其原生权限执行该工具；若希望只运行固定模型，应将实际命令放进`config.arguments`，并收紧inputSchema禁止覆盖它。工具不存在、被拒绝或执行失败都会如实返回。需要依赖时，先通过原技能库的requirements/prepare读取和准备，再运行真实模型。

通过项目助手调用`ares_extension`读取清单后传入真实命令与最新项目修订号。后台任务使用返回的原job跟踪，不能重复发起。模型应把来源记录一同保留，不能把模拟计算结果写成真实调查结论。
