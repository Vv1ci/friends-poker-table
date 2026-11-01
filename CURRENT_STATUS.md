# 当前状态

更新日期：2026-11-01（Asia/Shanghai）。

## 工作位置与源码基准

- 实际工作目录：`D:\Codex\friends-poker-table`。
- 用户指定仓库：`https://github.com/Vv1ci/friends-poker-table`。
- 对照基准：`main` 的 `c8ad65ddba9cfe3b7c730b896e40a43e39e32862`。
- GitHub 直连克隆失败，因此使用用户指出范围内的本地源码副本，经 GitHub 连接器返回的文件树逐文件核对哈希。业务代码、测试、依赖清单和锁文件与基准一致；原本 README 文案有差异，本轮仅更新与退出相关的规则说明。
- 本目录是源码工作副本，没有 `.git` 元数据。未复制认证文件、私人环境配置、原房间数据库；未修改系统设置或 Git remote。

## Milestone：退出修复与可选不掉线模式（审核通过，GitHub 上传及线上部署完成）

### 已实现

- 设置中的“离开牌桌”发送认证、同源的 `leave` 指令，等待服务器确认再返回首页；请求失败保留牌桌并允许重试。
- 服务器按真实会话身份释放座位；退出指令可重复调用，不依赖客户端旧版本号，并在并发冲突时重新读取和重试。
- 电脑接管原座位，保留筹码、底牌、公牌、已下注额、行动顺序和动画门限；不影响其他真人正在使用的行动时限。
- 使用独立 D1 表 `poker_room_presence` 记录心跳。原有 1.2 秒轮询同时续期，不修改牌局版本、不重置电脑行动计时。
- 普通模式在最后一次心跳后保留 30 秒重连宽限期；期限内刷新恢复原位，超时后释放为电脑。超时后须用有效邀请链接重新加入。
- 不限时房间新增“不掉线模式”，创建房间与房主重开弹窗均可设置；牌桌顶部显示已启用的模式。旧房间及未选择新模式的房间仍默认关闭。
- 不掉线模式下，关闭网页、断网或长时间无心跳均保留真人座位、筹码、手牌、进度、房主权限与邀请凭证；轮到离线真人时等待其回来，不自动操作。主动退出、手动转让、房主移出玩家仍照常生效。
- 服务端只接受严格布尔值 `noDisconnect: true`，且仅在行动不限时的房间生效；限时房间提交该设置也会被规范化为关闭，原行动倒计时规则保留。
- 模式只能由房主通过重开修改；从不掉线切回普通模式时所有座位获得新的完整 30 秒宽限期，不因旧心跳刚切换就被清退。
- 对旧房间缺失的在线记录自动初始化并给予完整宽限期。新增表由既有运行时 schema 初始化逻辑创建，未操作线上数据。
- 并发心跳与超时清理通过数据库条件校验，已续期的用户不会被旧快照清退。
- 房主主动退出，或普通模式断线超时后，按座位顺序转给剩余真人并轮换邀请凭证；普通模式同批超时的人不会接到权限。不掉线模式不会因离线自动交接。
- 无真人时房主为空，保留当时有效邀请凭证；下一位凭有效邀请入座的人成为新房主。
- 退出后的旧请求不能把牌桌重新显示回来；其他标签页收到座位失效响应时返回首页并说明原因。

### 实际修改文件

- `app/page.tsx`：服务器确认退出、重复操作保护、后台响应保护、座位失效处理。
- `app/disconnect-setting.tsx`：复用的“不掉线模式”选项，含行为说明，限时房间隐藏。
- `app/glass.css`：选项布局，沿用既有深浅主题变量及自适应样式。
- `app/api/rooms/[code]/route.ts`：退出指令、心跳/超时清理接入、入座登记及错误代码。
- `lib/room-core.ts`：纯函数形式的座位接管、超时判断、房主交接和空房入座。
- `lib/room-store.ts`：在线表、心跳、版本不变的在线同步、并发保护、幂等退出。
- `lib/room-types.ts`：退出指令类型。
- `tests/room-core.test.ts`：累计新增 9 项退出、超时、不掉线保留及模式切换行为回归测试；已有设置断言补充新字段。
- `tests/room-mode.test.tsx`：新增 2 项设置组件渲染回归测试。
- `tests/room-presence-http.mjs`：本地真实 HTTP/数据库联机回归，包含真实 30 秒等待。
- `tests/room-mode-http.mjs`：不掉线模式真实 HTTP/D1 联机回归，等待超过 30 秒验证保留、恢复与权限。
- `package.json`：仅将新增模式组件测试纳入 `test` 命令，没有修改依赖版本或锁文件。
- `README.md`：更新退出、断线、权限交接与多标签页规则。
- `CURRENT_STATUS.md`：本文件。

### 测试命令与真实结果

运行时：`C:\Users\19045\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`（Node v24.22.1）；执行时只为当前进程补充 PATH。

1. 使用 `node node_modules/typescript/bin/tsc lib/poker.ts lib/room-types.ts lib/room-core.ts tests/poker-engine.test.ts tests/room-core.test.ts tests/session-core.test.ts tests/card-motion.test.tsx tests/bet-sizing.test.ts tests/betting-panel.test.tsx tests/room-mode.test.tsx --outDir tests/.compiled --module commonjs --moduleResolution node --target es2022 --jsx react-jsx --esModuleInterop --skipLibCheck --types node` 编译，随后 `node --test` 执行 `tests/.compiled/tests/*.test.js`：**57 项通过，0 失败**，包括全部原有测试与本轮新增测试。覆盖牌型、主池/边池、退回筹码、行动顺序、下注、筹码守恒、权限、身份与动画等。
2. `node_modules/.bin/vinext.cmd build`：**通过**。
3. `node_modules/.bin/wrangler.cmd types --config dist/server/wrangler.json`，随后 `node_modules/.bin/tsc.cmd --noEmit`：**通过**。
4. 临时本机服务：`node_modules/.bin/vinext.cmd dev --port 3012`；测试和用户审核地址为 `http://localhost:3012`。
5. 进程环境 `POKER_TEST_URL=http://localhost:3012`，执行 `node tests/session-http.mjs`：**通过**。覆盖原有匿名身份、同源、邀请、六座位、重连、房主转让、撤销权限、手牌隔离和旧版本拒绝。
6. 同一测试地址执行 `node tests/room-presence-http.mjs`：**通过**。覆盖重复/并发退出、心跳不改变版本、接管保留牌局、原玩家权限撤销、真实 30 秒超时、房主自动/主动交接、邀请轮换与空房恢复。
7. 同一测试地址执行 `node tests/room-mode-http.mjs`：**通过**。六真人桌实际等待 32 秒，期间房主和当前行动者均不发心跳：座位、牌局版本、行动者、手牌、筹码和房主身份保持；恢复后原玩家可继续行动。另验证普通玩家不能重开、不允许替离线真人操作、房主切换模式、主动退出交接、踢人、限时模式强制关闭不掉线设置。
8. `git diff --no-index --check` 核对本轮修改的既有文件与基准：**无空白错误**。`package-lock.json` 的 Git blob SHA 仍为 `473ebacd7eb9fefcadca7d4b8f96e538d8c5ea19`，依赖未变。

初次依赖安装遇到沙箱 DNS 错误、初次构建/开发服务遇到沙箱权限错误；在已批准的执行权限下重试通过。未执行依赖版本升级。

### 限制及遗留

- 普通模式超时清理由服务器在房间请求时判断；有真人在线时由轮询触发，通常在 30 秒期限后的下一次轮询生效。无人打开页面时没有常驻后台计时器，再次访问时先清理过期座位；不掉线模式跳过此清理。
- 同一浏览器的多个标签页共享身份；任一标签主动退出会释放该身份的座位。关闭单个标签但另一标签仍保持心跳时，不会被当作离线。
- 普通模式浏览器长期冻结或后台暂停超过 30 秒且没有成功心跳，也会被按离线接管；不掉线模式保留座位，但仍依赖有效访客 Cookie，清除 Cookie、换设备或身份过期不能自动认回原玩家。
- 已完成代码、类型、生产构建及本地真实 HTTP/D1 测试；未执行浏览器点击式视觉验证。线上部署由 Sites 状态接口确认成功；终端 HTTP 验收在到达应用前被 Cloudflare 403 防护页拦截，因此未完成生产联机脚本验收。
- 本地测试房间与忽略的构建/运行时文件保持隔离；部署未清空或替换线上数据库，保留原 `DB` 绑定。运行时会按已有逻辑创建缺失的在线记录表。线上测试脚本在首页检查即被拦截，未创建测试身份或测试房间，也未访问现有房间。
- 本轮临时本地预览保持运行供用户审核，地址 `http://localhost:3012`，执行会话 ID `85072`；这不是系统持久服务。已请求在本任务旁打开本地预览（应用返回 queued），未声称已完成浏览器点击式视觉验收。

## 下一阶段与授权状态

- 用户已审核通过，并明确授权“上传 GitHub 并且部署”。
- GitHub 主分支代码提交：`5b973c717b062d9194dc691e3d25f60667bcd83d`，标题 `Fix departed-player stalls and add optional no-disconnect rooms`。
- GitHub Actions：`https://github.com/Vv1ci/friends-poker-table/actions/runs/41316339257`，`Poker checks` 已 `completed / success`；依赖安装、57 项测试、构建和类型检查均通过。
- 独立发布副本：`D:\Codex\friends-poker-table-release`。使用 Sites 官方 workflow 打开原网站源码仓库，将已审核的源码同步过去；开发副本的托管配置仍保持不含线上项目标识的形式。未复制私人配置、认证文件或本地数据库。
- 发布副本复用同锁文件的开发依赖（`node_modules` 本地目录联接），已重新生产构建；Sites 助手完成源码提交、上传和打包，工作区干净。
- Sites 项目：`appgprj_6a85784ca09881919aceff056a6994e5`；公开访问范围不变，数据库绑定 `DB` 不变。
- Sites 源码提交：`51b82374970971d2cd6f550d8dcfa1bf7845a829`。
- 保存版本：**21**，ID `appgprj_6a85784ca09881919aceff056a6994e5~appgver_0de33aa659ec819184158897bbe8cc1f`。
- 发布包：`D:\Codex\friends-poker-table-release\outputs\poker-release.tar.gz`，2,672,640 字节、83 个文件；SHA-256 `cc6a3875f96ca0b438908f538382fc913b5704669e16df35abbe1c793f524555`。
- 部署 ID：`appgdep_6ae74d4c9a348191974fc053c700daed`。部署调用连接中断后，通过保存版本取回已有部署 ID，再查询状态，未重复发起部署。
- 部署结果：`succeeded`，服务器更新时间 `2026-11-01T14:32:05.440625+00:00`（北京时间 2026-11-01 22:32:05）。
- 原网址：`https://friends-poker-table-zh.wffyffqff.chatgpt.site`；已请求在本任务旁打开，应用返回 queued。
- 生产冒烟脚本为发布副本忽略目录中的 `outputs/verify-live.mjs`；执行 `node outputs/verify-live.mjs` 后首页返回 Cloudflare `Attention Required!` 403，生产联机验收仍待正常浏览器网络确认。
- 本轮上传和部署工作已完成。此文档的最终发布记录将同步回 GitHub；仅记录变更，不改变已部署的业务代码。
- 后续新功能和托管/权限变更需另行授权；本 Milestone 完成后停止。

