# English source and Simplified Chinese catalog

`npm run i18n:extract` writes `messages.json`, a local list of every source message and the
files that use it. It is not committed.
`zh-CN.json` supplies host translations. Bundled plugins own their `i18n/zh-CN.json`.
See [the authoring guide](../../../docs/i18n.md) for extraction and validation.

Use these terms consistently in the initial Chinese translation:

| English | Simplified Chinese |
| --- | --- |
| Channel | 通道 |
| Connector | 连接器 |
| Source / Destination | 源 / 目标 |
| Filter / Transformer | 过滤器 / 转换器 |
| Deploy / Undeploy | 部署 / 取消部署 |
| Message | 消息 |
| Code Template / Library | 代码模板 / 模板库 |
| Global Script | 全局脚本 |
| Alert / Event | 告警 / 事件 |
| Dashboard | 仪表盘 |
| Data Type / Data Pruner | 数据类型 / 数据清理器 |

Keep product/protocol names (OIE, Mirth, HL7, DICOM, FHIR, NCPDP, X12, JavaScript,
E4X, TLS) and code examples intact. Preserve every named ICU argument and rich tag.
Native-speaker terminology review and release acceptance are still required.
