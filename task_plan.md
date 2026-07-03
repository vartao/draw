# 公司内部画图工具改造计划

## Goal
基于 `jgraph/drawio` 做公司内网版画图工具：默认中文、员工工号登录、服务器端按工号持久化文件、分享只读、常用导出与可部署运行。

## Current Phase
Phase 1-5 MVP 已完成。Phase 6A（上线运维底座与导出入口）已完成；当前剩余重点是依赖真实服务器环境的 Docker/Nginx/HTTPS 验证、内部 export server 部署决策、多人试用和固定密码替换方案。

## Phases
- [x] Phase 1: 部署基线与中文默认
- [x] Phase 2: 登录与会话
- [x] Phase 3: 公司文件服务
- [x] Phase 4: draw.io 前端集成公司存储 MVP
- [x] Phase 5: 分享只读
- [~] Phase 6: 导出与上线准备（Phase 6A 已完成，真实部署验证待环境）

## Completed Scope
- [x] 默认中文入口与配置兜底。
- [x] 屏蔽 Google Drive、OneDrive、Dropbox、GitHub、GitLab、Trello、插件等外部入口。
- [x] 新增 `company-server` 零依赖 Node 服务。
- [x] 实现工号 + 固定临时密码 `123456` 登录。
- [x] 实现 HTTP-only cookie 会话、`/api/me`、`/api/session`、退出登录。
- [x] 未登录访问公司页面或 draw.io HTML 编辑器时跳转登录。
- [x] 实现文件列表、新建、读取、保存、删除、重命名。
- [x] 按工号隔离目录：`data/employees/<employeeId>/files` 和 `meta`。
- [x] 文件名清洗、文件 ID 校验、路径穿越防护。
- [x] 临时文件 + rename 原子写入。
- [x] etag 保存冲突检测。
- [x] 工作台页面 `/app.html`。
- [x] 编辑器外壳 `/editor.html?id=<file-id>`，通过 draw.io `embed=1&proto=json` 消息协议保存到公司 API。
- [x] 分享 token 生成。
- [x] 访客 `/share.html?token=<token>` 无需登录只读访问。
- [x] 分享页不提供保存、重命名、删除入口。
- [x] Docker 部署说明更新。
- [x] Node 测试覆盖登录、文件隔离、冲突检测、分享读取。
- [x] 新增 `/api/health` 轻量探活和 `/api/ops/status` 运维状态接口。
- [x] 新增 JSONL 访问日志，分享 token 在日志中脱敏。
- [x] 新增 `npm run status` 运维状态命令。
- [x] 新增 `npm run backup` 数据目录备份命令和 `backup-manifest.json`。
- [x] 新增 Docker `HEALTHCHECK`。
- [x] 新增 Nginx HTTPS 示例配置 `deploy/phase2/nginx-https.example.conf`。
- [x] 新增登录用户与分享访客 XML 下载接口。
- [x] 编辑器外壳新增 PNG/SVG 快捷导出按钮，复用 draw.io 嵌入导出协议。
- [x] 新增 `/export` 内部 export server 反代预留；未配置时明确返回 503，不调用外部转换服务。
- [x] 新增 HTML 内联脚本检查脚本。

## Remaining Scope
- [ ] 在有 Docker 的环境执行 `docker compose -f deploy/phase2/docker-compose.yml config` 和完整容器启动验证。
- [ ] 在真实服务器部署 Nginx/HTTPS，替换示例域名和证书路径，生产环境设置 `DRAWIO_COOKIE_SECURE=1`。
- [ ] 配置生产 `DRAWIO_OPS_TOKEN`，将 `/api/ops/status` 纳入监控告警。
- [ ] 将 `npm run backup` 接入服务器定时任务，并确认异机/离线备份策略。
- [ ] 评估并部署内部 export server，以增强 PDF/服务端导出；设置 `DRAWIO_EXPORT_URL` 后验证 `/export`。
- [ ] 后续替换固定密码：LDAP/SSO 或首次登录改密。
- [ ] 可选：深度实现 draw.io 原生 `CompanyFile` / `CompanyStorageClient`，替代当前外壳集成方式。
- [ ] 做一轮多人试用和问题修复。

## Decisions
- 保留 draw.io 核心，新增公司外壳与后端，减少升级冲突。
- 公司文件保存使用 draw.io 已有 `embed=1&proto=json` 消息协议，先交付可用 MVP。
- 首期不做复杂用户/角色/部门权限；员工目录隔离和分享只读由后端保证。
- 分享链接使用随机 token，服务端保存 token hash 映射，不暴露真实路径。
- 分享页使用 `viewer-static.min.js` 只读渲染器，不暴露可编辑 iframe。

## Errors Encountered
| Error | Attempt | Resolution |
| --- | --- | --- |
| PowerShell 搜索命令引号解析失败 | 使用包含单双引号混合的 `rg` 查询 | 拆成更小的 `rg` 查询继续定位 |
| 本机未安装 Docker CLI | 运行 `docker --version` / `docker compose config` | 记录限制，Docker 配置待安装 Docker 后再验证 |
| `node --check` 不能直接检查 HTML | 对 HTML 文件运行 `node --check` | 改为抽取 `<script>` 内容并用 `new Function` 做语法检查 |
| Node `fetch` 默认跟随 302 | 烟测断言未登录 `/app.html` 返回 302 | 改用 `redirect: "manual"` |
| PowerShell 管道中文进入 Node 后变成问号 | 烟测脚本直接断言中文页面文本 | 改用 ASCII DOM id 做断言 |
| 本地临时服务端口设置失败 | `Start-Process` 命令中 `$env:PORT` 被提前展开为空，进程尝试占用 8081 | 改用单引号命令字符串，成功在 8092 启动最新服务 |
