# 水球大作战互联网 / pet-kit 适配候选

本轮游戏源码验收完成（2026-10-14），新版公网登录的最终双机证据见文末；安装包与Release未发布。

- 公共库固定 pet-kit 0.2.1，vendored 源码由库工具导出并在构建时重新核验摘要。
- 默认 HTML 声明 auto，单独 LAN 文件使用相同应用协议；SDK 声明仍为 v2。既有附件不自动升级，双方使用相同文件。
- 保留游戏规则、预测、插值、人数和原有断线/退出义务。联网由宿主邀请、同意和认证会话承担。
- 产物版本、字节数、协议和 SHA-256 以 dist/build.json、dist/build-lan.json 为准。
- 隐藏真实应用使用隔离数据与端口、真实 CDP 输入、后台截图；仅清理本轮进程。

## Verification boundary / 验证边界

27项规则、4项网络断言、构建/vendor摘要、双产物契约与最终隐藏浏览器回归通过。真实应用三人LAN、四人relay、四人混合来源报告 `05-41-30-859Z / 05-43-50-685Z / 05-48-14-257Z` 通过：真实邀请/授权/形象、全屏操作、相同整场结算、CPU接管与同款素材、再战/继续及关闭退出。Relay用真实生产模块与合成测试票据。

实体双Mac `06-09-08-709Z` 通过真实Test手机号登录/好友、公网WSS、禁LAN、接收磁盘摘要、双方操作和离场。实体路径只验短局，整场由本机多宿主门槛证明。固定旧登录宿主，不代表新强制登录公网流程已验收；当时公网activation接口404，后续独立登录任务已部署服务，最终新路径见文末。首次绘制前隐藏、后台截图核查、实际进程退出均通过；远端SIGTERM后归属检查再SIGKILL兜底。原生Keychain用隔离AES夹具替代，未验安装包或实体弱网。

This source candidate does not publish an installer, marketplace entry or host download location. The shared game library owns transport and appearance lifecycle; game-specific authority and prediction remain in the game. Physical Test-account acceptance is a separate gate from loopback tests.

Full three/four-player games passed on real isolated Electron hosts, including mixed LAN/relay, shared appearance and CPU takeover. Physical public-relay tests cover short play and leave on the pinned legacy-login host; newer public mandatory login was pending at that historical checkpoint; final admission acceptance is recorded below. The final artifact also passed the latest mandatory-login host locally against a real isolated production account service. This proves the local admission and full game path, not public SMS delivery or deployment.

## 最新Test组合验证 / Latest Test integration

宿主固定快照6f0b017e（保留新强制登录、好友身份与内置布偶提交），最终HTML在 `07-06-23-998Z` 完成真实隔离账号服务登录与三人整场/整关、相同结果、CPU接管/继续或再战、房主关闭、首绘前隐藏和实际PID退出；后台截图已检查。产物摘要与上述六轮多人和实体短局一致。宿主账号与门禁本轮未改；本轮无服务器部署。

The latest Test host passed real local account admission and the complete three-player lifecycle with the unchanged final artifact. The earlier pinned-host physical results retain their narrower scope; post-deployment public admission is verified separately below.

## 部署后当前准入的实体复验 / Public admission acceptance

`2026-10-14T08-54-14-681Z` OK：当前Test强制登录源码57e54655与最终相同HTML，真实UI获取开发验证码/登录、好友申请接受、禁LAN公网WSS、Vibe列表递送/双方磁盘摘要、配对/SDK授权、每屏双方真实操作、显式离场通过。后台截图核查、隐藏首绘、实际自有PID退出与新准入失效化/HTTP200登出均通过；远端SIGTERM后有归属检查的SIGKILL兜底。仍仅实体短局，完整多人结果由上文3/4人门槛证明；原生Keychain、实体弱网和安装包未覆盖。本批次没有部署服务。

The unchanged final artifact passes two physical Macs through the newly deployed Test admission service, real development-OTP UI, friend requests and public WSS with LAN disabled. Both disks match; each screen observes both real players' actions and explicit departure. Hidden-before-paint isolation, actual process termination and server-side session cleanup are verified. Physical short play does not replace the complete three/four-player lifecycle reports above. No installer or server deployment is performed by this delivery.
