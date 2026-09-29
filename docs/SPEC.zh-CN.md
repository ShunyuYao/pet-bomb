# 桌宠水球大作战 · 规格

在格子地图上放水球，水花十字炸开冲掉纸箱、捡道具；被水花打中困进泡泡，队友碰一下救出，对手碰一下戳破。2–4 人局域网联机（桌宠「发送并一起玩」+ 控制栏「＋ 邀请」），也可以单人对电脑。每个人用自己的桌宠上场：3D 布偶或 2D 立绘。

每条规则后面的「→」是对应的自动化断言，全部由真实输入（按键、文件选择）或规则模块的公开入口驱动，不直接改内部标志。断言分四层：`rules`（node 规则单测）、`net`（模拟宿主会话，含丢包、限速）、`browser`（普通浏览器，真实按键）、`host`（三台真实桌宠宿主）。

## §1 地图：小院子
- 15 × 13 格。最外圈是墙；内部横纵坐标都是偶数的格子是家具（不可破坏）。→ `rules: map is 15×13 with walls on the border and furniture on even/even cells`
- 其余空地约 60% 放纸箱；四个出生角（(1,1)、(13,11)、(13,1)、(1,11)）各留出角格及其相邻两格为空地。→ `rules: every spawn corner keeps an L of three free cells`
- 纸箱位置和纸箱里藏的道具都由每回合的种子决定，同一个种子在每台机器上生成完全相同的地图。→ `rules: the same seed builds the same map and hidden items`
- 纸箱约 35% 藏道具；标准道具：水球 +1、水量 +1、拖鞋；「进阶」（默认）另加踢水球和针。→ `rules: hidden items follow the mode (no kick or needle in standard)`

## §2 移动
- 用 WASD 或方向键上下左右走，同时按两个方向以后按的为准；速度 4 格/秒，每只拖鞋 +0.6，上限 7 格/秒。→ `rules: speed starts at 4 cells/s and shoes add 0.6 up to 7`；`browser: D walks right`
- 墙、家具、纸箱、水球挡路；人和人不互相挡。→ `rules: walls, furniture, crates and balloons block; players pass through each other`
- 贴着家具转弯时，如果离通道不到 0.4 格，会自动滑进通道。→ `rules: turning near a corner slides into the lane`

## §3 水球
- 按 J 或空格，在脚下格子放一颗水球（这一格没有水球、自己场上的水球数未到上限时）。→ `rules: J places a balloon on the player's cell up to the capacity`；`browser: space places a balloon`
- 2.5 秒后十字炸开，每边格数等于水量；水花停留 0.5 秒。→ `rules: a balloon bursts after 2.5 s into a cross as long as the fire range`
- 水花被墙和家具挡住；冲开碰到的第一个纸箱后停下，纸箱里的道具露出来；本来就躺在地上的道具被水花冲掉。→ `rules: splash stops at furniture and at the first crate; revealed items survive, lying items are washed away`
- 水花碰到别的水球，那颗立即引爆（连锁）。→ `rules: splash sets off other balloons at once (chain)`
- 站在自己刚放的水球上可以走开；走开后这颗水球就挡路了。→ `rules: you can walk off a balloon you just placed but not back onto it`

## §4 泡泡
- 被水花打中就困进泡泡，持续 4 秒，泡泡里移动 1 格/秒，不能放水球、不能捡道具。→ `rules: splash traps a player in a bubble for 4 s at 1 cell/s`
- 同队的人碰到（中心距离 < 0.8 格）就救出，救出后无敌 1 秒；对手碰到就戳破，被困的人出局；4 秒没人碰也出局。→ `rules: a teammate's touch frees, an opponent's touch pops, the timer pops`
- 大乱斗没有队友，任何别人碰到都会戳破。→ `rules: in free-for-all any touch pops`
- 带着针被困时按 K 立即脱困并用掉针（无敌 1 秒）；没有针按 K 没反应。→ `rules: K uses a needle to get out of a bubble`；`browser: K without a needle leaves you trapped`；`net: a guest who holds a needle and presses K is freed on every screen`

## §5 道具
- 走进道具所在的格子就捡起：水球 +1（上限 8）、水量 +1（上限 8）、拖鞋（见 §2）、踢水球（本回合一直有效）、针（最多带 1 根，多的不捡）。→ `rules: items apply their effect and respect their caps`

## §6 踢水球
- 有踢水球道具时，朝一颗水球走过去就把它踢出去：它以 8 格/秒沿该方向滑动，直到下一格是墙、家具、纸箱、别的水球或有人才停；地上的道具不挡，它从上面滑过去；引信照常走。→ `rules: a kicked balloon slides at 8 cells/s until blocked (items do not block), its fuse keeps running`
- 滑动途中被水花碰到立即引爆。→ `rules: a sliding balloon hit by splash bursts`

## §7 回合
- 倒计时 3 秒（不能动）→ 对战 2 分钟 → 回合结算。→ `rules: countdown freezes players`；`browser: the countdown freezes movement`
- 最后 30 秒外圈往里落书：从外圈第 1 圈开始按顺时针一格一格落，约 0.37 秒一格，落完第 2 圈为止；书落下的格子变成墙，格子里的人直接出局，水球立即引爆，道具消失。→ `rules: the last 30 s drops books along the two outer rings; a book knocks out whoever stands there`
- 最后剩下一人（组队时剩下一队）赢这一回合；同时全部出局，或 2 分钟到时仍有两方以上存活，算平局，不计分。→ `rules: the last side standing wins the round; simultaneous knock-out or time-up is a draw`
- 3 局 2 胜（或 5 局 3 胜，大厅里选）。先赢够回合数的一方赢整场；打满 5 回合（5 局 3 胜时 7 回合）仍没人赢够，整场平局。每回合换一个种子。→ `rules: first to 2 round wins takes the match; too many draws end in a draw`

## §8 模式与分队
- 大乱斗：各自为战。组队 2v2：出生角左边两个为橘队，右边两个为蓝队。→ `rules: team mode puts left corners in orange and right corners in blue`
- 单人练习：大乱斗 2 / 3 / 4 人，或组队 2v2，空位由电脑补。联机时空位一律由电脑补满 4 人。→ `net: a room of three humans is filled with one computer player`

## §9 电脑玩家
- 会躲：知道每颗水球什么时候炸、炸到哪，提前走到安全格。→ `rules: a computer player steps out of a blast it can see coming`
- 会冲纸箱、捡道具，看得到对手时会放水球堵人；困难档会去戳破被困的对手、救被困的队友、会踢水球。→ `rules: a 4-computer free-for-all plays out: most rounds end before time and nobody stays stuck`
- 难度三档：简单 / 普通 / 困难，区别是反应时间和出手频率。

## §10 画面与角色
- 斜俯视，整张地图固定在一屏，不跟人；两侧是四个人的道具卡（水球、水量、速度、踢、针），被困的人显示剩余时间。
- 形象三种：3D 布偶（`pet.character.getRealtime()` 或导入角色包）、2D 立牌（当前桌宠的图，或导入图片）、内置玩具（电脑玩家、普通浏览器）。队伍 / 玩家颜色只加在脚下圆环、水球和名字牌上。→ `browser: a picture becomes a 2D standee`、`a doll pack becomes a 3D doll`；`host: each pet is drawn as its own 2D / 3D kind on every screen`
- 被困时泡泡包住整个角色，头顶是倒计时圈。→ `browser: a trapped player is drawn inside a bubble`
- 前后遮挡按格子行号排序，2D 立牌不会「站进」家具里。
- Esc 在宿主里会直接关窗，所以游戏里不用 Esc；P 显示键位。

## §11 联机
星形：客人只连房主。所有房间、形象、压缩、限速都由共用底座 pet-kit 负责（见 pet-kit 的说明），这里只写本游戏的同步方式。

| 事情 | 谁说了算 |
|---|---|
| 自己走路 | 自己这台，其他人以约 110 ms 延迟插值显示 |
| 放水球 | 自己先放下，房主确认；同一格两人同时放，先到房主的算；被拒时本机撤回 |
| 爆炸时刻 | 放下时刻（按对齐后的房主时钟）+ 2.5 秒，每台都知道，到点一起炸 |
| 爆炸结果（纸箱、道具、连锁、谁被困） | 房主，作为事件广播；客人到点先按本机格子预演水花，事件到了以事件为准 |
| 被困判定 | 房主，用被打中的人自己上报的、爆炸那一刻的位置判（在自己画面里逃出去了就算逃出去了）；那人的位置还没报到爆炸时刻的，最多等 250 ms |
| 捡道具 | 房主；自己先显示捡起，被别人抢先时撤回 |
| 踢水球 | 踢的人本机先滑；每台按「起点、方向、时刻、速度」和格子算同一条轨迹；被人挡住停下由房主判定并广播停点 |
| 救出、戳破、用针、出局、落书 | 房主 |
| 电脑玩家 | 房主 |

- 地图不整张同步：每回合的种子 + 按顺序应用的爆炸事件 = 当前格子。房主每 2 秒发一次格子哈希，客人对不上就请求整张格子。→ `net: every screen ends each round with the host's grid (hash)`
- 事件（放下、爆炸、捡起、踢、被困、救出、戳破、出局、落书）走 pet-kit 的事件通道：带序号，对方确认前一直重发。→ `net: under 3% loss every screen sees every balloon placed by others within 150 ms (p95)`
- 流量与延迟（候选门槛，跨网联机标准）：压缩后每个客人收到的数据 ≤ 8 KB/秒；模拟 1 Mbps、往返 100 ms 时，状态落后时间 P95 ≤ 150 ms。→ `net: bytes per guest stay under 8 KB/s after compression`、`net: state age p95 stays under 150 ms on a 1 Mbps / 100 ms link`
- 形象只在大厅传，开局后不传；没收到的人先用内置形象。→ `net: avatars travel in the lobby only`
- 所有人准备好才开局；开局后才进来的人等这一场打完，回到大厅再上场。客人中途离开由电脑接管；房主离开整个房间结束。→ `net: a guest leaving mid-round is taken over by a computer player; the host leaving ends the room`
- 三台结算必须一致：比分、每回合胜方、统计表。→ `net: all screens agree on scores and the stats table`；`host: identical results on all three hosts`

## §12 测试
| 命令 | 内容 |
|---|---|
| `npm run test:rules` | 规则单测（node） |
| `npm run test:net` | 1 房主 + 2 客人（+1 电脑），模拟宿主会话，丢包 3%，另跑一组 1 Mbps / 100 ms 限速 |
| `npm run test:browser` | 普通浏览器：真实按键、文件选择打完一场 |
| `npm run test:host` | 三台真实桌宠宿主：真实发送、配对、授权、控制栏邀请、各自键盘打完一场 |

宿主端测试需要上一级的桌宠测试版源码，以及 `../rat-doll-lab/dist` 下的本地角色包（私人素材，不进仓库）。
