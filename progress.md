# 进度记录

## 2026-07-03
- 已读取 Notion 页面 `公司内部画图工具实施计划`。
- 已完成 Phase 1：中文默认、外部集成入口屏蔽、部署基线文档。
- 已完成 Phase 2：登录页、工号 + `123456` 登录、HTTP-only session、`/api/me`、`/api/logout`、未登录跳转。
- 已完成 Phase 3：文件列表、新建、读取、保存、删除、重命名、工号目录隔离、文件名清洗、etag 冲突检测、原子写入。
- 已完成 Phase 4 MVP：使用 draw.io `embed=1&proto=json` 协议实现编辑器外壳保存到公司 API。
- 已完成 Phase 5：分享 token、无需登录只读分享页、分享页禁止保存/删除/重命名源文件。
- 已新增 `company-server/public/company.css`、`app.html`、`editor.html`、`share.html`。
- 已修复原 `login.html` 中文乱码和断裂 JS。
- 已更新 `company-server/README.md` 和 `deploy/phase2/README.md`。
- 已新增 `company-server/server.test.js` 和 npm 脚本。

## Verification
- `npm run check`：通过。
- `npm test`：通过。
- HTML 内联脚本语法检查：通过。
- API/静态资源烟测：通过。

## Phase 6A Update
- 已完成上线运维底座：`/api/health`、`/api/ops/status`、JSONL 访问日志、分享 token 日志脱敏。
- 已新增 `npm run status` 和 `npm run backup`，备份会生成 `backup-manifest.json`，默认跳过访问日志。
- 已新增 Docker `HEALTHCHECK` 和 `deploy/phase2/nginx-https.example.conf` HTTPS 反代示例。
- 已新增登录用户 `/api/files/:id/download` 和分享访客 `/api/share/:token/download` XML 下载接口。
- 已在 `/app.html` 文件列表增加下载入口。
- 已在 `/editor.html` 增加 PNG/SVG 快捷导出按钮，复用 draw.io `action: "export"` 嵌入协议。
- 已新增 `/export` 内部 export server 反代预留；未配置 `DRAWIO_EXPORT_URL` 时返回 `503 export_server_not_configured`。
- 已新增 `scripts/check-html.js` 并纳入 `npm run check`。

## Phase 6A Verification
- `npm run check`：通过，包含 `server.js`、运维脚本、备份脚本、HTML 检查脚本和 4 个公司页面内联脚本。
- `npm test`：通过，覆盖登录、文件隔离、保存冲突、分享读取、XML 下载、访问日志脱敏、备份命令、`/export` 反代。
- `npm run status`：通过，返回数据目录可写、员工/图纸/分享数量和容量统计。
- `npm run backup`：通过，已用临时 `backups-test` 验证备份 manifest，验证后已删除测试备份目录。
- HTTP 烟测：最新服务在 `http://127.0.0.1:8092/` 启动成功，登录、创建文件、文件下载、分享下载、运维状态、删除烟测文件均通过。

## Next
- 如本机或服务器后续安装 Docker，再验证 `deploy/phase2/docker-compose.yml`。
- 在真实服务器替换 Nginx 示例域名/证书路径并启用 `DRAWIO_COOKIE_SECURE=1`、`DRAWIO_OPS_TOKEN`。
- 将 `npm run backup` 接入定时任务并确认异机/离线备份策略。
- 决策是否部署内部 export server；如部署，设置 `DRAWIO_EXPORT_URL` 后验证 PDF/服务端导出。
- 做多人试用和问题修复；后续替换固定密码方案。
