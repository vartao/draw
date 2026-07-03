# 发现记录

## Notion 规格
- 项目目标来自 Notion 页面：`公司内部画图工具实施计划`。
- 范围：中文默认、工号登录、按工号目录持久化、文件增删改查、分享只读、复用 draw.io 导出能力。
- 非目标：复杂组织权限、多人协作、审批流、网盘系统。

## draw.io 接入点
- 默认中文和外部集成开关位于 `drawio/src/main/webapp/js/PreConfig.js`。
- draw.io 支持嵌入消息协议：`/index.html?embed=1&proto=json`。
- 父页面收到 `init` 后可发送 `{ action: "load", xml, title, autosave: 1 }`。
- 编辑器保存时会向父页面发送 `{ event: "save", xml }`。
- 自动保存会发送 `{ event: "autosave", xml }`。
- 父页面可发送 `{ action: "invokeAction", actionName: "save" }` 触发保存。
- 父页面可发送 `{ action: "status", message, modified }` 更新编辑器状态。

## 后端实现
- `company-server/server.js` 是零依赖 Node HTTP 服务。
- 会话保存在内存并持久化到 `data/sessions.json`。
- 文件元数据和 XML 分开保存，目录按工号隔离。
- 文件写入使用同目录临时文件和 rename。
- 文件 etag 使用 XML SHA-256，保存时可检测并发冲突。
- 分享 token 只返回原始 token 给创建者，磁盘保存 token hash 文件。

## 前端实现
- `/login.html`：中文登录页。
- `/app.html`：员工文件工作台。
- `/editor.html?id=<file-id>`：公司编辑外壳，内嵌 draw.io。
- `/share.html?token=<token>`：无登录只读分享页，使用 `viewer-static.min.js`。
- `/company.css`：公司页面共享样式。

## 验证结果
- `npm run check` 通过。
- `npm test` 通过。
- HTML 内联脚本语法抽检通过。
- 临时端到端烟测通过：静态资源、登录跳转、登录、工作台、创建文件、分享页、分享 API。

## Phase 6A 上线运维发现
- `/api/health` 可作为 Nginx、Docker healthcheck 或外部监控的轻量探活；会检查数据目录可写性。
- `/api/ops/status` 返回运行时间、数据目录、员工/图纸/分享/会话数量、容量统计、日志路径和关键运行配置；配置 `DRAWIO_OPS_TOKEN` 后需 Bearer token。
- JSONL 访问日志默认写入 `data/logs/access.log`；`/api/share/<token>` 和 `/api/share/<token>/download` 会被脱敏为 `[token]`。
- `npm run status` 复用同一套运维状态统计逻辑。
- `npm run backup` 会复制 `sessions.json`、`employees`、`shares` 并生成 `backup-manifest.json`；默认跳过 `data/logs`。
- Docker 镜像已加入 `/api/health` healthcheck。
- HTTPS 反代示例位于 `deploy/phase2/nginx-https.example.conf`，需要真实域名和证书路径后才能上线使用。

## Phase 6A 导出发现
- 登录用户可通过 `/api/files/:id/download` 下载自己的 `.drawio` XML 文件。
- 分享访客可通过 `/api/share/:token/download` 下载只读 XML 副本，仍不能保存、删除或重命名源文件。
- `/editor.html` 的 PNG/SVG 快捷导出按钮复用 draw.io 嵌入协议 `action: "export"`，不修改 draw.io 核心。
- `/export` 是受登录保护的内部 export server 反代入口；未配置 `DRAWIO_EXPORT_URL` 时明确返回 503，避免默认调用外部转换服务。
- PDF/服务端导出仍需要内部 export server；当前已完成接入预留和文档，但未在真实 export server 上验证。

## Known Limits
- 本机没有 Docker CLI，容器配置和启动尚未本机验证。
- 分享页当前提供只读查看和 XML 下载；PNG/SVG 快捷导出在登录后的编辑器外壳中提供，PDF 需要内部 export server 或浏览器打印能力。
- 固定密码仍是首期临时方案，生产前需要替换或收紧内网访问。
- Nginx/HTTPS 示例尚未在真实服务器证书和域名上验证。
- 多人试用、备份定时任务、监控告警阈值和内部 export server 选型仍需生产环境决策。
