# 桌宠水球大作战

一个单文件 HTML 的放水球对战游戏，给「吐梨邦」桌宠的 HTML 作品能力做的。在格子地图上放水球，水花十字炸开冲掉纸箱、捡道具；被水花打中会困进泡泡，队友碰一下救出，对手碰一下戳破。

- 在桌宠里打开：自动带入你当前的桌宠（3D 布偶或 2D 立绘）。
- 和朋友一起玩：在桌宠里「发送并一起玩」这份 HTML，再用游戏窗口控制栏的「＋ 邀请」拉第 3、4 个人，最多 4 人，只走局域网；空位由电脑补上。
- 单人练习：普通浏览器直接打开也能玩，大乱斗 2–4 人或组队 2v2。

交付文件：`dist/桌宠水球大作战.html`（three.js、cannon-es 与全部代码内联，无 CDN、无服务器）。

需要桌宠测试版 0.26.0-internal.8 及以上（4 人房间）。

## 键位

| 键 | 作用 |
|---|---|
| W A S D / 方向键 | 走（同时按两个方向，以后按的为准） |
| J / 空格 | 放水球 |
| K | 被困时用针自救 |
| 走向水球 | 有踢水球道具时把它踢出去 |
| P | 显示 / 隐藏键位 |

Esc 在桌宠里会直接关掉游戏窗口，想离开请点右上角「离开」。

## 开发

```bash
npm run build        # dist/桌宠水球大作战.html
npm run test:rules   # 规则单测
npm run test:net     # 联机（pet-kit 的严格模拟宿主：丢包、限速、宿主限额）
npm run test:browser # 普通浏览器端到端（真实按键）
npm run test:host    # 三台真实桌宠宿主端到端（需要本地宿主源码与角色包）
npm run kit:update   # 换进 ../pet-kit 的当前版本，之后跑全部测试
```

规则、数值和每条规则对应的测试见 [docs/SPEC.zh-CN.md](docs/SPEC.zh-CN.md)。

## 第三方

- pet-kit 0.1.0（MIT）：`vendor/pet-kit/`，联机房间、传输、形象读取；由 `npm run kit:update` 写入，不在本仓库里改。
- three.js 0.164.1（MIT）、cannon-es 0.20.0（MIT）：`vendor/lib/`
- pet-ragdoll-renderer 0.2.0（MIT）：`vendor/doll/`，说明见其中的 NOTICE.md
- 其余美术（场景、道具、水球、角色玩具）和音效都由代码生成，没有外部素材。

MIT License.
