/* ============================================================
   《跳转之外》 main.js —— 第七阶段：全屏广告页 + 多领域中奖广告
   ------------------------------------------------------------
   核心机制（一次一个 · 不循环 · 时间只在点击时减少）：
   初始只有 1 个"紧急呼救"目标在深处
   每次点击（点广告/点空白/空格/倾斜）= 一次"广告事件"：
       → 恰好生成 1 个广告（固定序列 AD_SEQUENCE，各出现一次）：
         · 全屏广告页素材（广告13/14/15）→ 手机竖屏全屏插页
         · 多领域"恭喜中奖"动态广告（8 种 · 以 youwon 为视觉标准）：
           话费 / 数码 / 外卖 / 游戏 / 出行 / 黄金 / 美妆 / 加油
       → 点击 ✕ 关闭 = 误触跳转："正在打开……"（进度卡 87%）→ 又是广告
       → 时间只在点击时减少（每次扣 1.5~2.2 秒，不随真实时间流逝）
       → 序列放完不循环：继续点击只扣时间并提示"没有更多"
       → 时间归零的那次点击：广告 = jackpot（中奖弹窗），随后整体结束
   ------------------------------------------------------------
   Arduino 接入点（按传感器动作幅度分发）：
       轻微倾斜 → handleSmallTilt()    与常规跳转一致
       明显倾斜 → handleStrongTilt()   与常规跳转一致
       连续晃动 → 连续调用 handleTiltTrigger()（内置冷却，冷却中的点击不计次）
       反向倾斜 → handleReturnAttempt() 尝试返回（被拦截）
   ============================================================ */

/* ============ 全局配置：调整距离/速度/冷却就改这里 ============ */
var CONFIG = {
  pageWidth: 10,             // 页面宽度
  pageHeight: 14,            // 页面高度
  spacing: 4.2,              // 相邻页面的 Z 轴间距（紧密堆叠，侧向旋转时能看到真实3D深度）
  emergencyExtraDistance: 55,// 紧急呼救页与广告页群之间的额外距离
  newPageFlyIn: 26,          // 新页面从多深处开始飞入
  animDuration: 750,         // 页面飞入动画时长(ms)
  cooldown: 1100,            // 触发冷却时间(ms)，防止抖动连跳
  cooldownLate: 650,         // 后期（9层以上）冷却缩短：页面出现更频繁
  fogNear: 30,
  fogFar: 500,               // 雾拉远：让深处的紧急呼救不被完全吞没

  /* --- 透明度（按层次深度渐变，背景互相透出）--- */
  frontOpacity: 0.78,        // 最前层页面背景不透明度
  depthOpacityFall: 0.09,    // 每深一层，背景不透明度减少量
  minOpacity: 0.28,          // 最深层页面背景不透明度下限
  contentOpacity: 0.95,      // 文字/按钮层不透明度（各层都保持较高辨识度）
  adBackOpacity: 0.45,       // 背板（厚度侧面）基准透明度（随背景等比缩放）

  /* --- 渐进拥挤（只压缩"新页面"的间距，绝不移动旧页面）--- */
  crowdStart: 6,             // 从第几层开始压缩间距
  crowdFull: 12,             // 达到完全压缩的层数
  crowdSpacingShrink: 0.35,  // 新页面间距最多压缩到原来的 65%

  /* --- 持续细微错位（每一层生成时确定，永不改变、永不归零）--- */
  maxOffsetX: 2.5,           // X 错位范围（±2.5，≈页宽的 25%，整体聚在中央）
  maxOffsetY: 2.0,           // Y 错位范围（±2.0，≈页高的 14%）

  /* --- 紧急呼救页 --- */
  emergencyScale: 1.25,      // 尺寸 = 普通页面的 1.25 倍
  emergencyOpacity: 0.92
};

/* ============ 广告素材库（全部虚构，按类别分主题配色）============ */

/* 视觉主题：不同广告类别 = 不同配色 + 不同图片色调 + 不同按钮色
   仍保持深色底（融入《跳转之外》的暗色空间），但各有明确的色彩身份 */
var THEMES = {
  /* 电商促销：红橙暖色 */
  shop:   { bg: '#2a130d', bg2: '#1c0c07', border: 'rgba(255,110,60,0.45)', edge: 0x8a4530,
            accent: '#ff6a3d', accent2: '#ffb03a', price: '#ffd24a', gold: '#ffd24a',
            btnFill: '#e23a20', btnStroke: '#ff8a5c', text: '#fff3ec', sub: '#cfa598',
            photo: ['#5a2f14', '#200e06'] },
  /* 游戏推广：紫蓝 + 金币 */
  game:   { bg: '#161033', bg2: '#0e0a20', border: 'rgba(138,108,255,0.45)', edge: 0x5a4aa0,
            accent: '#8a6cff', accent2: '#3ddc97', price: '#ffce3a', gold: '#ffce3a',
            btnFill: '#6a4de0', btnStroke: '#a68cff', text: '#f0ecff', sub: '#a89ed6',
            photo: ['#31215e', '#120c2c'] },
  /* 生活服务：青绿 + 橙色点缀 */
  life:   { bg: '#0c2320', bg2: '#071714', border: 'rgba(23,184,166,0.45)', edge: 0x2a6e64,
            accent: '#17b8a6', accent2: '#f0a03a', price: '#f0a03a', gold: '#f0a03a',
            btnFill: '#0f9d8d', btnStroke: '#57d6c5', text: '#eafaf7', sub: '#93c6bd',
            photo: ['#0f3f38', '#06211c'] },
  /* 美妆时尚：玫瑰粉 + 奶油色 */
  beauty: { bg: '#2a161d', bg2: '#1c0e13', border: 'rgba(224,135,154,0.45)', edge: 0x7a4a58,
            accent: '#e0879a', accent2: '#f3d8cf', price: '#f3d8cf', gold: '#e8c9a0',
            btnFill: '#c26a7e', btnStroke: '#f0b6c2', text: '#fbedf0', sub: '#c9a3ad',
            photo: ['#54313c', '#221219'] },
  /* 旅游出行：湖蓝 + 沙滩金 */
  travel: { bg: '#0d1f2e', bg2: '#081521', border: 'rgba(90,180,224,0.45)', edge: 0x2a5570,
            accent: '#5ab4e0', accent2: '#ffd57a', price: '#ffd57a', gold: '#ffd57a',
            btnFill: '#1f6f9e', btnStroke: '#7cc4ec', text: '#eef6fb', sub: '#9db8c9',
            photo: ['#123a52', '#071722'] },
  /* 视频娱乐：紫红 + 亮蓝 */
  video:  { bg: '#1d0f22', bg2: '#120816', border: 'rgba(226,60,106,0.45)', edge: 0x7a3550,
            accent: '#e23c6a', accent2: '#4aa8ff', price: '#e23c6a', gold: '#ffce3a',
            btnFill: '#c22a55', btnStroke: '#ff7ba0', text: '#fdeef4', sub: '#bd9cc4',
            photo: ['#471743', '#1a0a1c'] },
  /* 应用安装：中性蓝（具体颜色由各应用自己的 t 决定） */
  app:    { bg: '#141924', bg2: '#0d111a', border: 'rgba(120,150,200,0.4)', edge: 0x4a5568,
            accent: '#5a8fd9', accent2: '#8ea4b8', price: '#8ea4b8', gold: '#ffce3a',
            btnFill: '#33507c', btnStroke: '#6f9bd4', text: '#eef2f6', sub: '#9aa0a8',
            photo: ['#25304a', '#10141f'] },
  /* 系统窗口：保持克制的深灰（与彩色商业广告形成区别） */
  system: { bg: '#1a1d22', bg2: '#121418', border: 'rgba(120,130,145,0.35)', edge: 0x555c66,
            accent: '#8ea4b8', accent2: '#5a6570', price: '#c9a06a', gold: '#b8a06a',
            btnFill: '#2c3542', btnStroke: '#5a6570', text: '#e8e8e8', sub: '#9aa0a8',
            photo: ['#232a33', '#14181d'] },
  /* 明亮原生风（白底 · 信息流 / 应用安装 / 横幅 —— 对应真实移动广告的白卡版式） */
  bright:  { bg: '#f8f9fb', bg2: '#e9ecf1', border: 'rgba(120,130,145,0.3)', edge: 0xb8c0cc,
             accent: '#2f6fed', accent2: '#ffb800', price: '#ff4d3a', gold: '#ffb800',
             btnFill: '#1e7bff', btnStroke: '#7cb0ff', text: '#1b1f26', sub: '#6b7480',
             photo: ['#e3e9f2', '#c5d0e0'] },
  /* 优惠券白卡（红字 + 红按钮 —— Carrefour 票券风） */
  couponw: { bg: '#ffffff', bg2: '#f2f3f5', border: 'rgba(226,58,32,0.35)', edge: 0xd8908a,
             accent: '#e23a20', accent2: '#ff7a1a', price: '#e23a20', gold: '#ffb800',
             btnFill: '#e23a20', btnStroke: '#ff8a70', text: '#1b1f26', sub: '#6b7480',
             photo: ['#f0e3e0', '#e0cbc8'] },
  /* 中奖弹窗（紫金 · YOU WON 专属：全系统最浓的商业诱导色） */
  youwon:  { bg: '#2b0a45', bg2: '#150426', border: 'rgba(255,210,58,0.55)', edge: 0x8a5ac2,
             accent: '#ffd23a', accent2: '#ff3d8a', price: '#ffd23a', gold: '#ffd23a',
             btnFill: '#ff9d1c', btnStroke: '#ffe27a', text: '#fff8e6', sub: '#d9b8f0',
             photo: ['#3d1465', '#1c0836'] }
};

/** '#rrggbb' → 'rgba(r,g,b,a)'（主题色带透明度使用） */
function hexA(hex, a) {
  var n = parseInt(hex.slice(1), 16);
  return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
}

/* ============ 图片素材替换接口 ============
   把真实素材图片放进 assets/ads/ 目录，然后在这里注册即可自动替换对应占位图：
     PAGE_IMAGES['game_art_0'] = 'assets/ads/game_art_0.jpg';
   key 规则：<类别>_<序号>，可用类别：
     product / game / video / beauty / scene / ui / abstract
   未注册的类别继续使用程序化绘制（cover 裁切填满图框）。 */
var PAGE_IMAGES = {};
var _imgCache = {};
function getRegisteredImage(key) {
  var url = PAGE_IMAGES[key];
  if (!url) return null;
  if (_imgCache[url] === undefined) {
    var img = new Image();
    img.onload = function () { _imgCache[url] = img; };
    img.src = url;
    _imgCache[url] = null;   // 加载中
  }
  return _imgCache[url] || null;
}

/* ============ 真实素材图片广告系统（assets/images/）============
   15 张实拍素材已人工分类为两种形态：
     popup   —— 弹窗型截图（素材内自带悬浮卡片）→ 中型悬浮窗，压在前页上方
     fullPage —— 全屏型广告页 → 手机竖屏比例的全屏插页
   素材按序号循环使用；图片异步加载，加载完成后自动重绘。 */
var AD_ASSETS = {
  popup: [
    'assets/images/广告1.jpg',
    'assets/images/广告3.jpg',
    'assets/images/广告4.jpg',
    'assets/images/广告5.jpg',
    'assets/images/广告6.jpg',
    'assets/images/广告7.jpg',
    'assets/images/广告8.jpg',
    'assets/images/广告9.jpg',
    'assets/images/广告11.jpg',
    'assets/images/广告12.jpg'
  ],
  fullPage: [
    'assets/images/广告13.webp',
    'assets/images/广告14.jpg',
    'assets/images/广告15.webp',
    'assets/images/广告20.webp',
    'assets/images/广告21.jpg',
    'assets/images/广告22.png',
    'assets/images/广告23.jpeg'
  ]
};

/* ============ 多领域"恭喜中奖"动态广告（以 youwon 为版式标准 · 每个领域独立色系）============
   同一套版式语言：径向渐变底 + 旋转光芒 + 纸屑 + 徽章 + 渐变脉冲标题 +
   过期收缩条 + 渐变光泽大按钮 + 中奖名单滚动。
   视觉差异来自色板（PRIZE_PALETTES）：每个领域一套完整配色。
   中部主视觉按领域：
     boxes  —— 三个礼盒"选一个开奖"（数码 / 美妆）
     ticket —— 票券卡（话费 / 外卖 / 出行 / 加油）
     big    —— 大字金额（游戏 / 黄金） */
var PRIZE_PALETTES = {
  /* 电信蓝（话费） */
  blue:  { bgIn:'#0a2a6e', bgOut:'#04102e', ray:'rgba(90,168,255,0.13)',
           badge:'#4aa8ff', badgeText:'#04162e',
           t1:'#d6ecff', t2:'#4aa8ff', t3:'#1f6fd9', tStroke:'#0a2a54', tGlow:'rgba(90,168,255,0.55)',
           sub:'#9ec8ef', expire:'#ffb8c8',
           confetti:['#4aa8ff','#3ddc97','#ffffff','#7cc4ec','#ffd23a'],
           accent:'#1f6fd9', card:'#eef6ff', cardBorder:'#4aa8ff',
           btn1:'#7cc4ec', btn2:'#1f6fd9', btnStroke:'#d6ecff', btnText:'#04162e',
           tickText:'#c9e2f7', boxes:['#e23a5c','#2f6fed','#17b06a'] },
  /* 深空青（数码） */
  cyan:  { bgIn:'#06303a', bgOut:'#02121a', ray:'rgba(61,220,151,0.12)',
           badge:'#3ddc97', badgeText:'#03251a',
           t1:'#d9fff0', t2:'#3ddc97', t3:'#0f9d78', tStroke:'#0a3a2c', tGlow:'rgba(61,220,151,0.55)',
           sub:'#93d9c2', expire:'#ffc4d1',
           confetti:['#3ddc97','#4aa8ff','#ffffff','#ffd23a','#ff3d8a'],
           accent:'#0f9d78', card:'#ecfff7', cardBorder:'#3ddc97',
           btn1:'#7fe8c3', btn2:'#0f9d78', btnStroke:'#d9fff0', btnText:'#03251a',
           tickText:'#b9ecd9', boxes:['#3ddc97','#4aa8ff','#ffd23a'] },
  /* 红橙（外卖） */
  flame: { bgIn:'#5a1404', bgOut:'#200802', ray:'rgba(255,122,26,0.13)',
           badge:'#ff7a1a', badgeText:'#331103',
           t1:'#ffe3c4', t2:'#ff9d3a', t3:'#e2541c', tStroke:'#5a2308', tGlow:'rgba(255,122,26,0.55)',
           sub:'#eab89a', expire:'#ffd0b3',
           confetti:['#ff7a1a','#ffd23a','#ff5a4a','#ffffff','#ff9d3a'],
           accent:'#e23a20', card:'#fff4e8', cardBorder:'#ff9d3a',
           btn1:'#ffc48a', btn2:'#e2541c', btnStroke:'#ffe3c4', btnText:'#3a1305',
           tickText:'#f2cdb2', boxes:['#e23a20','#ff9d3a','#ffd23a'] },
  /* 紫金（游戏 · 原 youwon 标准） */
  royal: { bgIn:'#4a1470', bgOut:'#150426', ray:'rgba(255,210,58,0.10)',
           badge:'#ffd23a', badgeText:'#7a3c00',
           t1:'#fff3b0', t2:'#ffd23a', t3:'#ff9d1c', tStroke:'#7a3c00', tGlow:'rgba(255,210,58,0.55)',
           sub:'#d9b8f0', expire:'#ffb8d8',
           confetti:['#ffd23a','#ff3d8a','#3ddc97','#4aa8ff','#ff9d1c'],
           accent:'#e23a20', card:'#fff8e6', cardBorder:'#ffd23a',
           btn1:'#ffe27a', btn2:'#ff9d1c', btnStroke:'#fff3b0', btnText:'#7a3c00',
           tickText:'#e9d5ff', boxes:['#e23a5c','#2f6fed','#17b06a'] },
  /* 天空湖蓝（出行） */
  sky:   { bgIn:'#06304f', bgOut:'#02131f', ray:'rgba(122,196,236,0.13)',
           badge:'#7ac4ec', badgeText:'#052338',
           t1:'#e3f4fd', t2:'#7ac4ec', t3:'#2b8fc9', tStroke:'#0c3a56', tGlow:'rgba(122,196,236,0.55)',
           sub:'#a3c9de', expire:'#ffc4d4',
           confetti:['#7ac4ec','#ffffff','#3ddc97','#ffd57a','#4aa8ff'],
           accent:'#1f7fb8', card:'#eef8fe', cardBorder:'#7ac4ec',
           btn1:'#a8dbf5', btn2:'#2b8fc9', btnStroke:'#e3f4fd', btnText:'#052338',
           tickText:'#c6e4f5', boxes:['#2b8fc9','#ffd57a','#7ac4ec'] },
  /* 纯金（黄金） */
  gold:  { bgIn:'#4a3208', bgOut:'#170f02', ray:'rgba(255,210,58,0.14)',
           badge:'#ffd23a', badgeText:'#4a3200',
           t1:'#fff6d0', t2:'#ffce3a', t3:'#d8901c', tStroke:'#5a4008', tGlow:'rgba(255,210,58,0.6)',
           sub:'#e8d5a0', expire:'#ffe0b3',
           confetti:['#ffd23a','#fff6d0','#d8901c','#ffffff','#ff9d1c'],
           accent:'#c8860a', card:'#fffaea', cardBorder:'#ffce3a',
           btn1:'#ffe27a', btn2:'#d8901c', btnStroke:'#fff6d0', btnText:'#4a3200',
           tickText:'#efe0b3', boxes:['#d8901c','#ffd23a','#fff6d0'] },
  /* 玫瑰粉（美妆） */
  rose:  { bgIn:'#571430', bgOut:'#1e0611', ray:'rgba(240,150,175,0.13)',
           badge:'#f09aaf', badgeText:'#3d0e1f',
           t1:'#ffe6ee', t2:'#f09aaf', t3:'#d95f82', tStroke:'#5a1a30', tGlow:'rgba(240,150,175,0.55)',
           sub:'#d9a8b8', expire:'#ffd0da',
           confetti:['#f09aaf','#ff3d8a','#ffffff','#ffd23a','#c26a7e'],
           accent:'#d95f82', card:'#fff0f4', cardBorder:'#f09aaf',
           btn1:'#f8c2d0', btn2:'#d95f82', btnStroke:'#ffe6ee', btnText:'#3d0e1f',
           tickText:'#ecc0cf', boxes:['#d95f82','#c26a7e','#ffd23a'] },
  /* 能源绿（加油） */
  green: { bgIn:'#0a4520', bgOut:'#03180b', ray:'rgba(61,220,120,0.12)',
           badge:'#3ddc78', badgeText:'#032510',
           t1:'#d9ffe6', t2:'#3ddc78', t3:'#1ba854', tStroke:'#0a3a1e', tGlow:'rgba(61,220,120,0.55)',
           sub:'#96d9b0', expire:'#c8f0cf',
           confetti:['#3ddc78','#ffd23a','#ffffff','#4aa8ff','#1ba854'],
           accent:'#1ba854', card:'#ecfff3', cardBorder:'#3ddc78',
           btn1:'#8ae8ae', btn2:'#1ba854', btnStroke:'#d9ffe6', btnText:'#032510',
           tickText:'#bfe9cd', boxes:['#1ba854','#3ddc78','#ffd23a'] }
};

var PRIZE_DOMAINS = [
  { pal: PRIZE_PALETTES.blue, layout: 'B', badge: '话费', mode: 'ticket', title: '恭喜抽中话费红包', amount: '¥100',
    unit: '全国三网通用 · 充值秒到账', pickHint: '话费券已放入账户 · 过期作废',
    subPrefix: '您是本区第', subSuffix: '位幸运访客',
    btn: '立即充入手机', prizes: ['100元话费', '20元话费', '视频会员', '全国流量包', '5元红包'] },
  { pal: PRIZE_PALETTES.cyan, layout: 'A', badge: '数码', mode: 'boxes', title: '恭喜抽中旗舰手机',
    subPrefix: '您是今日第', subSuffix: '位锦鲤用户', pickHint: '选择一个礼盒 · 立即开奖',
    btn: '立即领取包邮到家', prizes: ['旗舰手机', '蓝牙耳机', '智能手表', '平板电脑', '充电宝'] },
  { pal: PRIZE_PALETTES.flame, layout: 'C', badge: '外卖', mode: 'ticket', title: '恭喜获得免单神券', amount: '免单',
    unit: '全场可用 · 今日下单立减', pickHint: '免单券已放入账户 · 过期作废',
    subPrefix: '您是本区第', subSuffix: '位手气用户',
    btn: '立即去下单抵扣', prizes: ['免单券', '满30减15', '无门槛红包', '霸王餐', '配送券'] },
  { pal: PRIZE_PALETTES.royal, layout: 'A', badge: '游戏', mode: 'big', title: '恭喜抽中至尊礼包', amount: '648',
    unit: '648 钻石礼包 · 领取秒到账', pickHint: '礼包已锁定 · 过期作废',
    subPrefix: '您是新服第', subSuffix: '位欧皇玩家',
    btn: '立即领取进游戏', prizes: ['648礼包', '限定皮肤', '十连抽卡', '传说武器', '688钻石'] },
  { pal: PRIZE_PALETTES.sky, layout: 'C', badge: '出行', mode: 'ticket', title: '恭喜抽中双人机票', amount: '往返',
    unit: '国内任意航线 · 周末通用', pickHint: '机票券已放入账户 · 过期作废',
    subPrefix: '您是本月第', subSuffix: '位幸运访客',
    btn: '立即选航班出行', prizes: ['双人往返机票', '五星酒店', '高铁票', '景区门票', '接送机券'] },
  { pal: PRIZE_PALETTES.gold, layout: 'B', badge: '黄金', mode: 'big', title: '恭喜抽中黄金红包', amount: '8.8g',
    unit: '足金克重 · 实时可卖可提', pickHint: '黄金已到账 · 过期作废',
    subPrefix: '您是本区第', subSuffix: '位幸运访客',
    btn: '立即存入黄金账户', prizes: ['8.8克黄金', '3.3克黄金', '88元现金', '金豆', '积分'] },
  { pal: PRIZE_PALETTES.rose, layout: 'A', badge: '美妆', mode: 'boxes', title: '恭喜抽中大牌礼盒',
    subPrefix: '您是今日第', subSuffix: '位锦鲤用户', pickHint: '选择一个礼盒 · 立即开奖',
    btn: '立即填写收货地址', prizes: ['大牌礼盒', '口红', '精华', '香水', '面霜'] },
  { pal: PRIZE_PALETTES.green, layout: 'B', badge: '加油', mode: 'ticket', title: '恭喜抽中加油卡', amount: '全年',
    unit: '免费加油 · 不限次数不限量', pickHint: '加油卡已放入账户 · 过期作废',
    subPrefix: '您是本市第', subSuffix: '位幸运车主',
    btn: '立即激活加油卡', prizes: ['全年加油卡', '500元油费', '洗车年卡', '保养券', '补胎券'] }
];

/* 固定播放序列（不重复、不循环）：
   去掉了弹窗类截图，只保留 3 张全屏广告页素材（F）
   + 8 个领域的"恭喜中奖"动态广告（P），交错排布，各出现一次。
   一次点击 = 恰好取出序列中的下一个；全部放完后不再生成任何广告。 */
var AD_SEQUENCE = [];
(function buildAdSequence() {
  var plan = ['F0','P0','P1','F1','P2','S','F2','P3','G','F3','P4','P5','F4','P6','R','F5','P7','F6'];
  var F = AD_ASSETS.fullPage, T = { S: 'spin', G: 'playable', R: 'goldpop' };
  plan.forEach(function (k) {
    var c = k.charAt(0), n = +k.charAt(1);
    if (c === 'F') AD_SEQUENCE.push({ type: 'imgfull', src: F[n] });
    else if (c === 'P') AD_SEQUENCE.push({ type: 'prize', domain: n });
    else AD_SEQUENCE.push({ type: T[c] });
  });
})();
var adSeqPos = 0;   // 序列游标：已经放到第几个

/** 取序列中的下一个；已放完返回 null（绝不循环） */
function nextAdItem() {
  if (adSeqPos >= AD_SEQUENCE.length) return null;
  return AD_SEQUENCE[adSeqPos++];
}

var _adImgCache = {};
/* 加载并缓存素材：状态跟踪（loading / ok / error），路径显式编码避免中文 404 */
function loadAdImage(url) {
  if (_adImgCache[url] === undefined) {
    var rec = { img: null, status: 'loading' };
    _adImgCache[url] = rec;
    var img = new Image();
    img.onload = function () { rec.img = img; rec.status = 'ok'; };
    img.onerror = function () { rec.status = 'error'; };
    img.src = encodeURI(url);
  }
  return _adImgCache[url];
}
function getAdImage(url) {
  var rec = loadAdImage(url);
  return rec.status === 'ok' ? rec.img : null;
}
/* 启动时预载素材（只预载仍在使用的全屏类；弹窗类截图已从作品中移除） */
function preloadAdAssets() {
  AD_ASSETS.fullPage.forEach(loadAdImage);
}

/* 商品促销（电商红橙主题） */
var PRODUCTS = [
  { name: '便携蓝牙音箱',  desc: '户外防水 · 24小时续航',  price: 199, was: 399 },
  { name: '智能保温杯',    desc: '温度显示 · 12小时保温',  price: 129, was: 259 },
  { name: '无线降噪耳机',  desc: '主动降噪 · 轻若无物',    price: 349, was: 699 },
  { name: '迷你家用投影仪', desc: '百寸巨幕 · 随身携带',   price: 899, was: 1599 },
  { name: '香薰助眠机',    desc: '静音雾化 · 定时关机',    price: 89,  was: 169 }
];

/* 活动弹窗（电商红橙主题） */
var PROMOTIONS = [
  { title: '周年狂欢节', sub: '全场满 300 减 80 · 叠加券可用', hours: 2, tags: ['满300减80', '新客立减', '可叠加券'] },
  { title: '会员专属日', sub: '双倍积分 · 专属价限时开启',    hours: 5, tags: ['双倍积分', '会员价', '免运费'] },
  { title: '午夜闪购场', sub: '整点开抢 · 先到先得',          hours: 1, tags: ['整点秒杀', '限量 500 件', '不可退'] }
];

/* 视频推荐（视频娱乐紫红主题） */
var FEEDS = [
  { title: '深夜城市的声音地图',   sub: '12.4万 热度' },
  { title: '独居青年的第 365 天',  sub: '23.7万 热度' },
  { title: '三分钟看完一部悬疑片', sub: '8.1万 热度' },
  { title: '这条老街要拆了吗',     sub: '5.6万 热度' },
  { title: '周末去哪儿 · 露营篇',  sub: '9.2万 热度' }
];

/* 应用下载（每个应用一套独立主色） */
function appTheme(bg, border, accent, btnFill, btnStroke, photoA, photoB) {
  return { bg: bg, bg2: bg, border: border, edge: 0x4a5568, accent: accent, accent2: accent,
           btnFill: btnFill, btnStroke: btnStroke, text: '#eef2f6', sub: '#a8b0ba',
           photo: [photoA, photoB] };
}
var APPS = [
  { name: '轻笔记',   desc: '极简记录 · 云端同步',     stars: 4, dl: '52万+',  glyph: '记',
    t: appTheme('#141924', 'rgba(90,143,217,0.5)',  '#5a8fd9', '#33507c', '#6f9bd4', '#25304a', '#10141f') },
  { name: '星图天气', desc: '分钟级降水预报',          stars: 5, dl: '31万+',  glyph: '晴',
    t: appTheme('#0e2033', 'rgba(74,168,255,0.5)',  '#4aa8ff', '#1f5f9e', '#7cc0ff', '#14304f', '#081524') },
  { name: '步数星球', desc: '把每天走的步数种成森林',  stars: 4, dl: '96万+',  glyph: '步',
    t: appTheme('#10261a', 'rgba(61,220,151,0.5)',  '#3ddc97', '#1d8f5c', '#6fe8ae', '#173f2a', '#08170f') },
  { name: '幻境远征', desc: '放置卡牌 · 上线领百抽',  stars: 4, dl: '210万+', glyph: '幻',
    t: appTheme('#161033', 'rgba(138,108,255,0.55)', '#8a6cff', '#6a4de0', '#a68cff', '#31215e', '#120c2c') }
];

/* 游戏推广（游戏紫蓝主题） */
var GAMES = [
  { title: '幻境远征', sub: '放置卡牌 · 挂机也变强',   reward: '登录领 648 礼包', dl: '210万+ 下载', stars: 4 },
  { title: '星际牧场', sub: '种菜 · 养宠 · 交朋友',    reward: '新服限时送神宠',  dl: '96万+ 下载',  stars: 5 },
  { title: '剑影江湖', sub: '武侠 · 开放世界大作',     reward: '预约抽限定外观',  dl: '330万+ 预约', stars: 4 }
];

/* 生活服务（青绿主题） */
var LIFE_ADS = [
  { title: '晚间打车 8 折',   sub: '周末前有效 · 全城可用',   tags: ['打车', '外卖', '买单'], amount: '立减 6 元' },
  { title: '外卖红包天天领',  sub: '下单即抵 · 可与会员同享', tags: ['美食', '超市', '买药'], amount: '最高 25 元' },
  { title: '周末保洁 5 折起', sub: '持证上门 · 不满意返工',   tags: ['保洁', '维修', '搬家'], amount: '首单 49 元' }
];

/* 美妆时尚（玫瑰粉主题） */
var BEAUTY = [
  { name: '雾面唇釉',     desc: '丝绒雾面 · 一抹显白',  price: 129, was: 259, tag: '新品' },
  { name: '玻尿酸精华',   desc: '水光充盈 · 敏感肌可用', price: 199, was: 399, tag: '热卖' },
  { name: '白茶香氛蜡烛', desc: '前调柑橘 · 尾调雪松',  price: 89,  was: 149, tag: '限量' }
];

/* 外卖（红橙主题 · 食物视觉 + 配送信息） */
var FOODS = [
  { shop: '川香居',    name: '一人食暖锅套餐',   rating: 4.8, sales: '月售 2,341', price: 39.9, was: 68,  eta: 32, tags: ['满30减8', '满50减15'] },
  { shop: '岭南糖水铺', name: '杨枝甘露双拼碗',   rating: 4.9, sales: '月售 5,682', price: 22,   was: 36,  eta: 25, tags: ['新客立减6', '第二份半价'] },
  { shop: '深夜食堂',   name: '和牛寿喜烧定食',   rating: 4.7, sales: '月售 986',   price: 78,   was: 128, eta: 40, tags: ['满80减20', '准时达'] }
];

/* 旅游（湖蓝主题 · 目的地大图 + 限时优惠） */
var TRAVELS = [
  { dest: '三亚', name: '5天4晚 海景自由行',    price: 1299, was: 2199, stock: 4, hours: 3 },
  { dest: '大理', name: '3天2晚 洱海环线',      price: 899,  was: 1499, stock: 3, hours: 2 },
  { dest: '成都', name: '4天3晚 熊猫美食之旅',  price: 1099, was: 1899, stock: 5, hours: 5 }
];

/* 原生信息流素材（伪装成普通内容 · 只有角落的小"广告"标识） */
var NATIVE_FEEDS = [
  { title: '这座城市最适合独处的 10 个角落', sub: '城市漫游指南 · 3小时前', thumb: 'scene' },
  { title: '通勤耳机怎么选？一篇讲透',       sub: '数码笔记 · 5小时前',     thumb: 'product' },
  { title: '周三半价！这些店正在打折',       sub: '附近优惠 · 刚刚',        thumb: 'abstract' },
  { title: '独居第一年，我学会的 8 件事',    sub: '生活手记 · 昨天',        thumb: 'ui' },
  { title: '周末短途出行的轻装清单',         sub: '出行参考 · 2天前',       thumb: 'scene' },
  { title: '年度最佳高分剧集盘点',           sub: '追剧手册 · 4小时前',     thumb: 'video' }
];

/* 通知条文案（系统样式 + 彩色图标；后两条专用于"广告打断广告"） */
var NOTICES = [
  { glyph: '信', color: '#e25c3a', title: '你有一条新的优惠信息', sub: '今日专属折扣已到账，点击查看',   time: '刚刚 · 来自合作推广' },
  { glyph: '火', color: '#f0a03a', title: '你关注的活动即将开始', sub: '闪购场 20 分钟后开启',           time: '2 分钟前 · 活动提醒' },
  { glyph: '礼', color: '#e0879a', title: '恭喜获得一张优惠券',   sub: '面额随机，有效期 24 小时',       time: '刚刚 · 互动有礼' },
  { glyph: '卷', color: '#ffd24a', title: '你的优惠券即将过期',   sub: '两张优惠券今天 23:59 失效',       time: '刚刚 · 优惠提醒' },
  { glyph: '店', color: '#17b8a6', title: '附近有 3 家店正在打折', sub: '距你 800 米 · 新客专享价',      time: '1 分钟前 · 附近推荐' }
];

/* 大字促销文案（电商红橙主题） */
var BIGSALES = [
  { num: '5',  unit: '折', title: '年中盛典 · 全场低至', sub: '数码 / 家电 / 美妆 通通参与', hours: 3 },
  { num: '-70', unit: '%', title: '清仓大甩卖',         sub: '部分商品售完即止',           hours: 1 },
  { num: '1',  unit: '元', title: '新用户专享福利',     sub: '首单立享超低价',             hours: 6 }
];

/* ============ 页面尺寸体系（相对标准页 10×14；画布长宽比与平面一致）============
   打破"一叠同尺寸竖屏卡片"：大页面 / 中型弹窗 / 小窗 / 通知条 / 横向广告条 */
var SIZES = {
  large:  { w: 1.0,  h: 1.0,  cw: 512, ch: 720 },   // 大型广告页面（主力）
  medium: { w: 0.68, h: 0.66, cw: 512, ch: 696 },   // 中型弹窗（约普通页 66%~68%）
  small:  { w: 0.46, h: 0.34, cw: 512, ch: 530 },   // 小型系统确认窗
  loader: { w: 0.44, h: 0.40, cw: 512, ch: 650 },   // 小型加载/跳转窗
  notice: { w: 0.90, h: 0.15, cw: 900, ch: 210 },        // 横向通知条
  banner:       { w: 1.15, h: 0.22, cw: 896, ch: 240 },   // 横向广告条（白底 Banner）
  interstitial: { w: 0.95, h: 1.15, cw: 512, ch: 864 },   // 全屏插页（手机竖屏比例）
  appinstall:   { w: 0.95, h: 1.0,  cw: 512, ch: 752 },   // 应用安装（白卡竖版）
  nativefeed:   { w: 1.0,  h: 0.9,  cw: 512, ch: 648 },   // 原生信息流（浅灰 feed + 白卡）
  coupon:       { w: 1.0,  h: 0.62, cw: 512, ch: 444 },   // 优惠券票券（横长票）
  youwon:       { w: 1.0,  h: 1.1,  cw: 512, ch: 788 }    // 中奖弹窗（竖版舞台）
};

/* ============ 各版式的空间行为 ============
   zBoost ：向前悬浮量 —— 小窗/弹窗压在前一个大页面上方（局部重叠关系）
   spread ：错位幅度倍率 —— 横条几乎不错位，小窗可以偏得多一点 */
var TYPE_PROFILE = {
  product:        { zBoost: 0,   spread: 1.0 },
  promotion:      { zBoost: 0,   spread: 1.0 },
  recommendation: { zBoost: 0,   spread: 1.0 },
  download:       { zBoost: 0,   spread: 1.0 },
  bigsale:        { zBoost: 0,   spread: 1.0 },
  game:           { zBoost: 0,   spread: 1.0 },
  life:           { zBoost: 0,   spread: 1.0 },
  beauty:         { zBoost: 0,   spread: 1.0 },
  video:          { zBoost: 0,   spread: 1.0 },
  playable:       { zBoost: 0,   spread: 1.0 },
  native:         { zBoost: 0,   spread: 1.0 },
  food:           { zBoost: 0,   spread: 1.0 },
  travel:         { zBoost: 0,   spread: 1.0 },
  coupon:         { zBoost: 1.4, spread: 1.4 },
  popup:          { zBoost: 1.5, spread: 1.5 },
  sysdialog:      { zBoost: 1.2, spread: 1.2 },
  redirect:       { zBoost: 1.8, spread: 1.6 },
  notification:   { zBoost: 0.7, spread: 0.5 },
  banner:         { zBoost: 0.5, spread: 0.4 },
  interstitial:   { zBoost: 0,   spread: 1.0 },   // 全屏插页：正常堆叠
  youwon:         { zBoost: 1.6, spread: 1.3 },   // 中奖弹窗：压到最前（高潮广告）
  prize:          { zBoost: 1.6, spread: 1.3 },   // 多领域中奖广告：与 youwon 同级（高潮广告）
  imgpopup:       { zBoost: 1.5, spread: 1.5 },   // 真实素材弹窗：悬浮在前页上方
  imgfull:        { zBoost: 0,   spread: 1.0 },   // 真实素材全屏页：正常堆叠
  goldpop:        { zBoost: 1.5, spread: 1.5 },   // 金币雨红包弹窗：悬浮（jackpot 风）
  spin:           { zBoost: 1.5, spread: 1.5 }    // 幸运转盘弹窗：悬浮（jackpot 风）
};

/* 初始页面（固定的第一个页面） */
var INITIAL_PAGE = { tag: 'AD · 跳转广告', title: '今日推荐', content: '为你推荐一些热门内容', button: '立即查看' };

/* 最深处的目标页面 */
var EMERGENCY_PAGE = { title: '紧急呼救', content: '需要医疗急救？', button: '拨打 120' };

/* ============ 全局状态 ============ */
var scene, camera, renderer, container;
var clock;

var pages = [];           // 当前活跃的广告页面（初始为空 —— 广告只能由误触/倾斜生成）
var emergencyPage = null; // 紧急呼救页（唯一目标，随广告增减前后移动）
var stackFrontZ = 0;      // 堆叠最前端的 Z（新页面在此之上逐层叠加）
var lastType = null;      // 上一个生成页面的类型（避免连续重复）

/* 120 的空间距离：广告越多越远，广告被关闭则靠近（真正的 3D 位移，非数字计数） */
var EMERGENCY_BASE_Z = 0;       // 初始位置（在堆叠轴线原点，靠近摄像机）
var EMERGENCY_RETREAT = 5;      // 每多一个活跃广告，120 后退的距离
var emergencyTargetZ = 0;       // 目标 Z（随 pages 数量变化）
var emergencyCurrentZ = 0;      // 当前 Z（每帧平滑逼近目标）

var orbit = { angleX: 0, angleY: 0, distance: 46, targetY: 2 };
var lookZTarget = 0;      // 摄像机注视的深度（随页面增加缓慢移动）
var lookZCurrent = 0;
var stackOffsetTarget = 0;   // 摄像机后退目标量（堆叠向前生长时自动后退）
var stackOffsetCurrent = 0;  // 当前后退量（平滑逼近目标）

var cooldownUntil = 0;    // 冷却截止时间戳
var shake = 0;            // 空间晃动强度（0~1，衰减）
var animations = [];      // 进行中的补间动画

/* ============================================================
   1. 基础设置
   ============================================================ */

function createScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0e11);
  scene.fog = new THREE.Fog(0x0d0e11, CONFIG.fogNear, CONFIG.fogFar);
}

function createCamera() {
  camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    600
  );
  camera.position.set(0, 5, 46);
  camera.lookAt(0, 2, 0);
}

function createLights() {
  var ambient = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(ambient);

  var key = new THREE.DirectionalLight(0xffffff, 0.7);
  key.position.set(15, 20, 30);
  scene.add(key);

  var fill = new THREE.DirectionalLight(0x8899aa, 0.25);
  fill.position.set(-20, 5, 10);
  scene.add(fill);
}

function createRenderer() {
  container = document.getElementById('scene-container');
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  // 透明物体按 renderOrder → 深度 排序，保证多层半透明正确叠加
  renderer.sortObjects = true;
  container.appendChild(renderer.domElement);
}

/* ============================================================
   2. 页面工厂
   ============================================================ */

/**
 * 通用页面创建 —— 生成一个漂浮的"界面物体"
 * opts: { tag, title, content, button, theme }
 *   广告页：轻微半透明（0.85），透过它能隐约看到后方页面
 *   紧急页：1.25 倍尺寸 + 高对比文字，可读性独立控制
 */
function createPage(opts) {
  var isEmergency = opts.theme === 'emergency';

  // 页面尺寸：紧急页固定 1.25 倍；普通页按版式 size 缩放
  // （大页面 / 中型弹窗 / 小窗 / 横条 —— 不同版式不同尺寸）
  var sw = isEmergency ? CONFIG.emergencyScale : (opts.size ? opts.size.w : 1);
  var sh = isEmergency ? CONFIG.emergencyScale : (opts.size ? opts.size.h : 1);
  var pw = CONFIG.pageWidth * sw;
  var ph = CONFIG.pageHeight * sh;

  /* ---- 双层 Canvas：背景层与内容层分开绘制 ----
     这样透明度可以分开控制：
     背景层随层次深度逐渐变透明（后方页面得以透出），
     文字/按钮/边框始终保持较高辨识度，不会糊成一团 */
  var W = opts.canvasW || 512, H = opts.canvasH || 720;   // 画布按版式提供（长宽比与平面一致）

  // 背景层：只有面板底色（透明度随深度变化的就是它）
  var bgCanvas = document.createElement('canvas');
  bgCanvas.width = W;
  bgCanvas.height = H;
  var bg = bgCanvas.getContext('2d');
  // 背景底色按主题着色（上亮下暗的微渐变，融入暗色空间）
  var bgGrad = bg.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, isEmergency ? '#241418' : (opts.th ? opts.th.bg : '#1a1d22'));
  bgGrad.addColorStop(1, isEmergency ? '#160b0d' : (opts.th ? opts.th.bg2 : '#121418'));
  bg.fillStyle = bgGrad;
  roundRect(bg, 6, 6, W - 12, H - 12, 24);
  bg.fill();

  // 内容层：透明底，边框 + 按页面类型绘制的专属布局
  var canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  var ctx = canvas.getContext('2d');

  // 边框（画在内容层，按主题着色，保证深层页面轮廓仍可辨）
  var pageBorder = isEmergency ? '#9a5555' : (opts.th ? opts.th.border : '#3a3f48');
  ctx.strokeStyle = pageBorder;
  ctx.lineWidth = isEmergency ? 4 : 3;
  roundRect(ctx, 6, 6, W - 12, H - 12, 24);
  ctx.stroke();

  // 绘制句柄：页面内部动态（倒计时/进度条/轮播）通过它局部重绘内容层
  var paint = {
    ctx: ctx, W: W, H: H,
    type: opts.type || (isEmergency ? 'emergency' : 'initial'),
    data: opts.data || opts,
    border: pageBorder,
    texture: null
  };
  (PAGE_PAINTERS[paint.type] || PAGE_PAINTERS.initial)(ctx, W, H, paint.data);
  if (LAST_CLOSE_BTN) { paint.closeBtn = LAST_CLOSE_BTN; LAST_CLOSE_BTN = null; }
  /* 紧急呼救页：注册 120 按钮的画布坐标（onClick 据此识别"拨打"动作） */
  if (paint.type === 'emergency') {
    paint.dialBtn = { x: W / 2, y: 474, w: 320, h: 88 };
  }

  var bgTexture = new THREE.CanvasTexture(bgCanvas);
  bgTexture.anisotropy = 4;
  var texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  paint.texture = texture;

  /* ---- 组装 3D 物体（半透明材质，depthWrite 关闭避免排序错误）---- */
  var group = new THREE.Group();

  // 背景面板（透明度随层次深度变化的部分：前 0.78 → 后 0.28）
  var panelMat = new THREE.MeshStandardMaterial({
    map: bgTexture, roughness: 0.85, metalness: 0.1,
    transparent: true,
    opacity: isEmergency ? CONFIG.emergencyOpacity : CONFIG.frontOpacity,
    depthWrite: false   // 关键：半透明物体不写入深度，避免后方页面被错误裁掉
  });
  var panel = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), panelMat);
  group.add(panel);
  group.userData.bgMesh = panel;
  panel.userData.pageGroup = group;   // 点击拾取时由 mesh 反查所在页面

  // 边框
  var edgeMat = new THREE.LineBasicMaterial({
    color: isEmergency ? 0xb06a6a : (opts.th ? opts.th.edge : 0x555c66),
    transparent: true,
    opacity: isEmergency ? 0.95 : 0.85,
    depthWrite: false
  });
  var edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(pw, ph)),
    edgeMat
  );
  edges.position.z = 0.02;
  group.add(edges);

  // 背板（厚度感）：半透明，透过后能看到更深的页面
  var backMat = new THREE.MeshStandardMaterial({
    color: 0x121418, roughness: 1,
    transparent: true,
    opacity: isEmergency ? 0.6 : CONFIG.adBackOpacity,
    depthWrite: false
  });
  var back = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, 0.3), backMat);
  back.position.z = -0.18;
  group.add(back);
  group.userData.backMesh = back;

  // 内容层：文字、按钮、边框（独立材质，背景变透明后仍保持辨识度）
  var contentMat = new THREE.MeshStandardMaterial({
    map: texture, roughness: 0.85, metalness: 0.1,
    transparent: true,
    opacity: isEmergency ? 1.0 : CONFIG.contentOpacity,
    depthWrite: false
  });
  var content = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), contentMat);
  content.position.z = 0.015;
  content.userData.isContent = true; // 同页内比背景层晚渲染
  group.add(content);
  group.userData.contentMesh = content;
  content.userData.pageGroup = group;

  // 假阴影（不透明，无排序问题）
  var shadow = new THREE.Mesh(
    new THREE.CircleGeometry(3.5 * Math.max(sh, 0.45), 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -ph / 2 - 3;
  group.add(shadow);

  // 记录材质基础透明度（飞入动画时按比例缩放）
  [panelMat, edgeMat, backMat, contentMat].forEach(function (m, i) {
    group.children[i].userData.baseOpacity = m.opacity;
  });

  // 内容层绘制句柄（页面内部动态重绘用）
  group.userData.paint = paint;

  // 最终固定位姿（生成时一次性确定并锁定，此后永不改变）
  group.userData.finalX = 0;
  group.userData.finalY = 4;
  group.userData.finalZ = 0;
  group.userData.finalTiltY = 0;
  group.userData.animating = false;

  scene.add(group);
  return group;
}

/* 画圆角矩形 */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ============================================================
   2.5 广告页面绘制器（不同类型 = 不同布局 + 不同主题配色）
   全部画在内容层（透明底），背景层按主题着色。
   主题系统（见 THEMES）：电商红橙 / 游戏紫蓝 / 生活青绿 /
   美妆玫瑰 / 视频紫红 / 应用各色 / 系统克制灰。
   字体、圆角、按钮结构保持统一 —— 变的是色彩身份和构图。
   ============================================================ */

/* --- 共用界面小部件 --- */

/** 「广告」小标识（细小、灰色，不抢视觉） */
function drawAdBadge(ctx, x, y) {
  ctx.save();
  ctx.fillStyle = 'rgba(120,130,145,0.9)';
  roundRect(ctx, x, y, 52, 26, 6);
  ctx.fill();
  ctx.fillStyle = '#1a1d22';
  ctx.font = '16px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('广告', x + 26, y + 14);
  ctx.restore();
}

/** 关闭按钮 ✕（后期会被新页面挡住 —— 主题的一部分）
    绘制时记录画布坐标，供"误触关闭"的点击拾取判定 */
var LAST_CLOSE_BTN = null;
function drawCloseBtn(ctx, x, y) {
  LAST_CLOSE_BTN = { x: x, y: y, r: 24 };
  ctx.save();
  ctx.strokeStyle = 'rgba(154,160,168,0.85)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, 16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 6, y - 6);
  ctx.lineTo(x + 6, y + 6);
  ctx.moveTo(x + 6, y - 6);
  ctx.lineTo(x - 6, y + 6);
  ctx.stroke();
  ctx.restore();
}

/** 统一按钮（th = 视觉主题，决定按钮颜色） */
function drawButton(ctx, x, y, w, h, label, th) {
  th = th || THEMES.system;
  ctx.save();
  ctx.fillStyle = th.btnFill;
  ctx.strokeStyle = th.btnStroke;
  ctx.lineWidth = 3;
  roundRect(ctx, x, y, w, h, 14);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 32px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2 + 2);
  ctx.restore();
}

/** 进度条 p: 0~1（color 缺省用系统主题色） */
function drawProgressBar(ctx, x, y, w, h, p, color) {
  ctx.save();
  ctx.fillStyle = 'rgba(90,101,112,0.35)';
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  if (p > 0.01) {
    ctx.fillStyle = color || THEMES.system.accent;
    roundRect(ctx, x, y, Math.max(h, w * p), h, h / 2);
    ctx.fill();
  }
  ctx.restore();
}

/** 五星评分 */
function drawStars(ctx, x, y, n) {
  ctx.save();
  ctx.fillStyle = '#b8a06a';
  ctx.font = '22px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  var s = '';
  for (var i = 0; i < 5; i++) s += i < n ? '★' : '☆';
  ctx.fillText(s, x, y);
  ctx.restore();
}

/** 构图化「照片」：按 kind + 主题色生成画面；若 PAGE_IMAGES 注册过真实图片则优先使用
    product=商品 / scene=场景 / ui=截图骨架 / abstract=光带 /
    game=游戏角色 / video=视频封面 / beauty=美妆产品 */
function drawPhoto(ctx, x, y, w, h, kind, v, th) {
  th = th || THEMES.system;
  ctx.save();
  var v2 = v || 0;

  /* 素材替换接口：注册过真实图片就用真实图片（cover 裁切填满） */
  var img = getRegisteredImage(kind + '_' + (v2 % 3));
  if (img) {
    ctx.save();
    roundRect(ctx, x, y, w, h, 12);
    ctx.clip();
    var s = Math.max(w / img.width, h / img.height);
    var iw = img.width * s, ih = img.height * s;
    ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, y, w, h, 12);
    ctx.stroke();
    ctx.restore();
    return;
  }

  /* 程序化绘制：底色按主题渐变 */
  var g = ctx.createLinearGradient(x, y, x + w * 0.35, y + h);
  g.addColorStop(0, th.photo[0]);
  g.addColorStop(1, th.photo[1]);
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, 12);
  ctx.fill();
  ctx.save();
  roundRect(ctx, x, y, w, h, 12);
  ctx.clip();

  if (kind === 'product') {
    /* 展台投影 + 主题色设备剪影 + 高光条 */
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h * 0.84, w * 0.3, h * 0.045, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hexA(th.accent, 0.6);
    roundRect(ctx, x + w / 2 - w * 0.11, y + h * 0.3, w * 0.22, h * 0.48, 12);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    roundRect(ctx, x + w / 2 - w * 0.075, y + h * 0.35, w * 0.05, h * 0.32, 6);
    ctx.fill();
    ctx.strokeStyle = hexA(th.accent2, 0.9);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h * 0.4, w * 0.065, 0, Math.PI * 2);
    ctx.stroke();
  } else if (kind === 'game') {
    /* 星空 + 光环 + 远山 + 角色剪影（头/肩/披风/剑光）+ 平台 + 金币 */
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (var s2 = 0; s2 < 16; s2++) {
      ctx.fillRect(x + seededRand(v2 * 31 + s2) * w, y + seededRand(v2 * 57 + s2 + 3) * h * 0.5, 2.5, 2.5);
    }
    ctx.fillStyle = hexA(th.accent, 0.3);
    ctx.beginPath();
    ctx.arc(x + w * 0.74, y + h * 0.22, w * 0.11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hexA(th.photo[0], 0.95);
    ctx.beginPath();
    ctx.moveTo(x - 4, y + h * 0.8);
    ctx.lineTo(x + w * 0.28, y + h * 0.52);
    ctx.lineTo(x + w * 0.6, y + h * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + w * 0.4, y + h * 0.85);
    ctx.lineTo(x + w * 0.75, y + h * 0.5);
    ctx.lineTo(x + w + 4, y + h * 0.85);
    ctx.closePath();
    ctx.fill();
    var cx = x + w * 0.36, cy = y + h * 0.64;
    ctx.fillStyle = 'rgba(10,8,20,0.92)';
    ctx.beginPath();                                          // 头
    ctx.arc(cx, cy - h * 0.15, w * 0.048, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();                                          // 肩身
    ctx.moveTo(cx - w * 0.09, cy + h * 0.2);
    ctx.quadraticCurveTo(cx - w * 0.075, cy - h * 0.05, cx, cy - h * 0.08);
    ctx.quadraticCurveTo(cx + w * 0.075, cy - h * 0.05, cx + w * 0.09, cy + h * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();                                          // 披风
    ctx.moveTo(cx - w * 0.08, cy + h * 0.02);
    ctx.lineTo(cx - w * 0.17, cy + h * 0.24);
    ctx.lineTo(cx - w * 0.02, cy + h * 0.17);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = hexA(th.accent2, 0.95);                 // 剑光
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx + w * 0.07, cy - h * 0.02);
    ctx.lineTo(cx + w * 0.18, cy - h * 0.15);
    ctx.stroke();
    ctx.fillStyle = hexA(th.accent, 0.4);                     // 平台
    roundRect(ctx, cx - w * 0.15, cy + h * 0.2, w * 0.3, h * 0.03, 4);
    ctx.fill();
    ctx.fillStyle = th.gold;                                  // 金币 ×3
    for (var c2 = 0; c2 < 3; c2++) {
      var gx = x + w * (0.64 + c2 * 0.1), gy = y + h * (0.72 - (c2 % 2) * 0.07);
      ctx.beginPath();
      ctx.arc(gx, gy, w * 0.03, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(58,42,0,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(gx, gy, w * 0.017, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (kind === 'video') {
    /* 径向光 + 人物剪影（视频封面感）+ 播放按钮 */
    var rg = ctx.createRadialGradient(x + w * 0.5, y + h * 0.42, 10, x + w * 0.5, y + h * 0.42, w * 0.62);
    rg.addColorStop(0, hexA(th.accent, 0.42));
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(x, y, w, h);
    var hx = x + w * 0.5, hy = y + h * 0.8;
    ctx.fillStyle = 'rgba(8,4,12,0.92)';
    ctx.beginPath();
    ctx.arc(hx, hy - h * 0.32, w * 0.095, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(hx - w * 0.22, hy);
    ctx.quadraticCurveTo(hx, hy - h * 0.24, hx + w * 0.22, hy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';                 // 播放按钮
    ctx.beginPath();
    ctx.arc(x + w * 0.5, y + h * 0.44, w * 0.088, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = th.accent;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.5 - w * 0.024, y + h * 0.44 - w * 0.038);
    ctx.lineTo(x + w * 0.5 - w * 0.024, y + h * 0.44 + w * 0.038);
    ctx.lineTo(x + w * 0.5 + w * 0.042, y + h * 0.44);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'beauty') {
    /* 奶油色柔光底 + 产品瓶身（唇釉/精华）+ 高光 + 倒影 */
    var bgd = ctx.createRadialGradient(x + w / 2, y + h * 0.42, 8, x + w / 2, y + h * 0.5, w * 0.75);
    bgd.addColorStop(0, hexA(th.accent2, 0.5));
    bgd.addColorStop(1, th.photo[1]);
    ctx.fillStyle = bgd;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = th.accent;                                // 瓶身
    roundRect(ctx, x + w / 2 - w * 0.09, y + h * 0.3, w * 0.18, h * 0.42, 18);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';                 // 高光
    roundRect(ctx, x + w / 2 - w * 0.055, y + h * 0.34, w * 0.035, h * 0.3, 8);
    ctx.fill();
    ctx.fillStyle = '#241419';                                // 瓶盖
    roundRect(ctx, x + w / 2 - w * 0.06, y + h * 0.22, w * 0.12, h * 0.08, 6);
    ctx.fill();
    ctx.fillStyle = hexA(th.accent, 0.16);                    // 倒影
    roundRect(ctx, x + w / 2 - w * 0.09, y + h * 0.78, w * 0.18, h * 0.1, 10);
    ctx.fill();
  } else if (kind === 'food') {
    /* 暖色柔光底 + 大碗（碗身 + 米饭 + 配菜）+ 热气 + 筷子（外卖食物视觉） */
    var warm = ctx.createRadialGradient(x + w / 2, y + h * 0.45, 10, x + w / 2, y + h * 0.5, w * 0.75);
    warm.addColorStop(0, hexA(th.accent2, 0.4));
    warm.addColorStop(1, th.photo[1]);
    ctx.fillStyle = warm;
    ctx.fillRect(x, y, w, h);
    var bx2 = x + w / 2, by2 = y + h * 0.66;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.32)';                 // 热气 ×3
    ctx.lineWidth = 5;
    for (var s3 = -1; s3 <= 1; s3++) {
      ctx.beginPath();
      ctx.moveTo(bx2 + s3 * w * 0.1, by2 - h * 0.22);
      ctx.quadraticCurveTo(bx2 + s3 * w * 0.1 + w * 0.055, by2 - h * 0.3, bx2 + s3 * w * 0.1, by2 - h * 0.38);
      ctx.stroke();
    }
    ctx.strokeStyle = '#d8a86a';                                // 筷子
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(bx2 + w * 0.24, by2 - h * 0.06);
    ctx.lineTo(bx2 + w * 0.44, by2 - h * 0.32);
    ctx.moveTo(bx2 + w * 0.31, by2 - h * 0.02);
    ctx.lineTo(bx2 + w * 0.52, by2 - h * 0.26);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';                         // 碗影
    ctx.beginPath();
    ctx.ellipse(bx2, by2 + h * 0.04, w * 0.26, h * 0.028, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = th.accent;                                  // 碗身
    ctx.beginPath();
    ctx.arc(bx2, by2, w * 0.31, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';                   // 碗身高光
    ctx.beginPath();
    ctx.arc(bx2 - w * 0.1, by2 + h * 0.08, w * 0.08, 0.25, Math.PI - 0.4);
    ctx.lineTo(bx2 - w * 0.06, by2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f5ead9';                                  // 碗口
    ctx.beginPath();
    ctx.ellipse(bx2, by2, w * 0.31, h * 0.085, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff8ec';                                  // 米饭
    ctx.beginPath();
    ctx.ellipse(bx2, by2 - h * 0.03, w * 0.21, h * 0.055, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hexA(th.accent, 0.85);                      // 配菜
    ctx.beginPath(); ctx.arc(bx2 - w * 0.1, by2 - h * 0.045, w * 0.032, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(bx2 + w * 0.075, by2 - h * 0.035, w * 0.028, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(bx2 - w * 0.005, by2 - h * 0.075, w * 0.024, 0, Math.PI * 2); ctx.fill();
  } else if (kind === 'travel') {
    /* 天空 + 太阳 + 海面反光 + 沙滩 + 椰树（目的地海报视觉） */
    var sky2 = ctx.createLinearGradient(x, y, x, y + h * 0.62);
    sky2.addColorStop(0, hexA(th.accent, 0.55));
    sky2.addColorStop(1, hexA(th.accent2, 0.28));
    ctx.fillStyle = sky2;
    ctx.fillRect(x, y, w, h * 0.62);
    ctx.fillStyle = hexA(th.accent2, 0.85);                     // 太阳
    ctx.beginPath();
    ctx.arc(x + w * 0.7, y + h * 0.16, w * 0.062, 0, Math.PI * 2);
    ctx.fill();
    var sea = ctx.createLinearGradient(x, y + h * 0.62, x, y + h * 0.84);
    sea.addColorStop(0, hexA(th.accent, 0.75));
    sea.addColorStop(1, th.photo[0]);
    ctx.fillStyle = sea;
    ctx.fillRect(x, y + h * 0.62, w, h * 0.22);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';                   // 海面反光
    for (var wv = 0; wv < 4; wv++) {
      ctx.fillRect(x + w * 0.56, y + h * (0.66 + wv * 0.036), w * 0.28, 3);
    }
    ctx.fillStyle = 'rgba(230,205,160,0.5)';                    // 沙滩
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + h * 0.85);
    ctx.lineTo(x + w * 0.55, y + h * 0.81);
    ctx.lineTo(x + w, y + h * 0.91);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#3a2c1a';                                // 椰树
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + w * 0.15, y + h * 0.93);
    ctx.quadraticCurveTo(x + w * 0.19, y + h * 0.72, x + w * 0.25, y + h * 0.58);
    ctx.stroke();
    ctx.fillStyle = 'rgba(40,80,60,0.85)';
    for (var l = 0; l < 5; l++) {
      var la = -0.5 + l * 0.45;
      ctx.beginPath();
      ctx.ellipse(x + w * 0.25 + Math.sin(la) * w * 0.07, y + h * 0.55 - Math.abs(la) * h * 0.02, w * 0.075, h * 0.017, la, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === 'scene') {
    /* 主题色天空 + 光源 + 双层山 */
    var sky = ctx.createLinearGradient(x, y, x, y + h);
    sky.addColorStop(0, hexA(th.accent, 0.35));
    sky.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sky;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = hexA(th.accent2, 0.7);
    ctx.beginPath();
    ctx.arc(x + w * (0.24 + 0.5 * (v2 % 2)), y + h * 0.2, w * 0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hexA(th.photo[0], 0.95);
    ctx.beginPath();
    ctx.moveTo(x - 4, y + h * 0.78);
    ctx.lineTo(x + w * 0.3, y + h * 0.44);
    ctx.lineTo(x + w * 0.62, y + h * 0.78);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.moveTo(x + w * 0.35, y + h);
    ctx.lineTo(x + w * 0.68, y + h * 0.5);
    ctx.lineTo(x + w + 4, y + h);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'ui') {
    /* 应用截图骨架：状态栏 + 主题色头图 + 长短列表行 */
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(x + 10, y + 10, w - 20, 8);
    ctx.fillStyle = hexA(th.accent, 0.32);
    roundRect(ctx, x + 10, y + 26, w - 20, h * 0.34, 6);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    for (var r = 0; r < 3; r++) {
      roundRect(ctx, x + 10, y + h * 0.34 + 40 + r * 26, w - 20 - r * 14 * (v2 % 2), 12, 6);
      ctx.fill();
    }
  } else {
    /* 抽象斜向光带（主题色，横条/活动用） */
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(-0.5);
    for (var i2 = -3; i2 <= 3; i2++) {
      ctx.fillStyle = hexA(th.accent, 0.26 - Math.abs(i2) * 0.03);
      ctx.fillRect(-w, i2 * h * 0.15 - h * 0.035, w * 2, h * 0.07);
    }
    ctx.restore();
  }

  /* 暗角（质感） */
  var vg = ctx.createRadialGradient(x + w / 2, y + h / 2, Math.min(w, h) * 0.35, x + w / 2, y + h / 2, Math.max(w, h) * 0.8);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = vg;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, x, y, w, h, 12);
  ctx.stroke();
  ctx.restore();
}

/* --- 各类型页面布局（painter）--- */

/** 应用截图占位（白底手机界面：状态栏 / 主题色头部 / 列表 / 底部导航） */
function drawAppShot(ctx, x, y, w, h, th, v) {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, x, y, w, h, 14);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,130,145,0.28)';
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, h, 14);
  ctx.stroke();
  ctx.save();
  roundRect(ctx, x, y, w, h, 14);
  ctx.clip();
  ctx.fillStyle = '#c8cdd4';                        // 状态栏
  ctx.fillRect(x, y, w, 18);
  var hb = 64 + (v ? 16 : 0);                       // 主题色头部 + 搜索框
  ctx.fillStyle = hexA(th.accent, 0.9);
  ctx.fillRect(x, y + 18, w, hb);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  roundRect(ctx, x + 14, y + 36, w - 28, 22, 11);
  ctx.fill();
  for (var i = 0; i < 4; i++) {                     // 列表行（灰色块 + 缩略图 + 文字条）
    var ry = y + 18 + hb + 14 + i * 62;
    ctx.fillStyle = i % 2 ? '#eef1f5' : '#e4e8ee';
    roundRect(ctx, x + 12, ry, w - 24, 50, 10);
    ctx.fill();
    ctx.fillStyle = hexA(th.accent, 0.45);
    roundRect(ctx, x + 20, ry + 9, 26, 26, 6);
    ctx.fill();
    ctx.fillStyle = '#c3c9d2';
    ctx.fillRect(x + 56, ry + 13, w - 108, 8);
    ctx.fillRect(x + 56, ry + 29, w * 0.42, 6);
  }
  ctx.fillStyle = '#f2f4f7';                        // 底部导航
  ctx.fillRect(x, y + h - 42, w, 42);
  for (var t = 0; t < 4; t++) {
    ctx.fillStyle = t === 0 ? hexA(th.accent, 0.8) : '#b9c0ca';
    ctx.beginPath();
    ctx.arc(x + w / 8 + t * w / 4, y + h - 21, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.restore();
}

var PAGE_PAINTERS = {

  /* 初始页：干净、简单 —— 一切"正常"的起点 */
  initial: function (ctx, W, H, d) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#6b7280';
    ctx.font = '22px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.tag, W / 2, 92);
    ctx.fillStyle = '#e8e8e8';
    ctx.font = 'bold 60px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.title, W / 2, 236);
    ctx.fillStyle = '#9aa0a8';
    ctx.font = '30px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.content, W / 2, 306);
    drawButton(ctx, (W - 320) / 2, 430, 320, 88, d.button, THEMES.system);
    drawAdBadge(ctx, 24, 24);
  },

  /* 1. 商品促销（电商红橙 · 大图主导）：大图向左出血 + 红底价格卡压角 + 红色购买按钮 */
  product: function (ctx, W, H, d) {
    var th = THEMES.shop;
    drawPhoto(ctx, 0, 0, 380, 370, 'product', d.variant || 0, th);   // 左出血
    ctx.save();                        // 价格卡压图（视觉焦点）
    ctx.fillStyle = 'rgba(24,9,5,0.95)';
    ctx.strokeStyle = th.accent;
    ctx.lineWidth = 2;
    roundRect(ctx, 330, 300, 152, 112, 12);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = th.price;
    ctx.font = 'bold 52px sans-serif';
    ctx.fillText('¥' + d.price, 406, 362);
    ctx.fillStyle = 'rgba(255,220,190,0.55)';
    ctx.font = '20px sans-serif';
    ctx.fillText('¥' + d.was, 406, 394);
    ctx.restore();
    ctx.save();                        // 斜置红色折扣标签
    ctx.translate(58, 56);
    ctx.rotate(-0.06);
    ctx.fillStyle = th.btnFill;
    roundRect(ctx, -10, -18, 116, 36, 8);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 21px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('限时 ' + Math.round((1 - d.price / d.was) * 100) + '% OFF', 48, 1);
    ctx.restore();
    ctx.textAlign = 'left';            // 名称 / 描述（左对齐，与图的左出血呼应）
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = th.text;
    ctx.font = 'bold 42px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.name, 44, 440);
    ctx.fillStyle = th.sub;
    ctx.font = '24px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.desc, 44, 478);
    ctx.strokeStyle = 'rgba(255,140,90,0.28)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(44, 508);
    ctx.lineTo(W - 44, 508);
    ctx.stroke();
    drawButton(ctx, 44, 542, 232, 80, '立即购买', th);   // 按钮左下
    ctx.textAlign = 'right';           // 服务标签右下（不对称收尾）
    ctx.fillStyle = th.sub;
    ctx.font = '19px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('分期免息 · 七天无理由', W - 44, 572);
    ctx.fillText('已有 2.3万+ 人付款', W - 44, 600);
    drawAdBadge(ctx, 24, H - 54);
    drawCloseBtn(ctx, W - 40, 40);
  },

  /* 2b. 大字促销（电商红橙 · 巨型黄字折扣）：巨大折扣数字 + 红色竖带 + 不对称排版 */
  bigsale: function (ctx, W, H, d) {
    var th = THEMES.shop;
    ctx.save();                        // 右侧红色竖向色带
    ctx.fillStyle = 'rgba(226,58,32,0.2)';
    ctx.fillRect(W - 132, 20, 112, H - 40);
    ctx.restore();
    ctx.textAlign = 'left';            // 巨大数字（黄色，电商大促感）
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = th.price;
    ctx.font = 'bold 225px "Arial Black", Arial, sans-serif';
    ctx.fillText(d.num, 28, 306);
    var nw = ctx.measureText(d.num).width;
    ctx.fillStyle = th.accent;
    ctx.font = 'bold 62px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.unit, 40 + nw, 300);
    ctx.fillStyle = th.text;          // 标题（小得多，形成对比）
    ctx.font = 'bold 38px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.title, 44, 396);
    ctx.fillStyle = th.sub;
    ctx.font = '24px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.sub, 44, 436);
    ctx.textAlign = 'right';           // 倒计时右下（动态）
    ctx.fillStyle = th.price;
    ctx.font = 'bold 30px "Courier New", monospace';
    ctx.fillText('距结束 ' + d.countdown, W - 150, 524);
    drawButton(ctx, 44, 560, 252, 82, '马上抢购', th);
    drawAdBadge(ctx, 24, 24);
    drawCloseBtn(ctx, W - 160, 44);
  },

  /* 2. 活动弹窗（电商红橙）：红橙斜光带主视觉 + 黄字优惠券标签行 + 倒计时 */
  promotion: function (ctx, W, H, d) {
    var th = THEMES.shop;
    ctx.save();                        // 主视觉：红橙交替斜光带
    ctx.translate(W / 2, 190);
    ctx.rotate(-0.42);
    for (var i = -4; i <= 4; i++) {
      var a = 0.26 - Math.abs(i) * 0.028;
      ctx.fillStyle = (i % 2 === 0) ? hexA(th.accent, a) : hexA(th.accent2, a);
      ctx.fillRect(-340, i * 44 - 12, 680, 22);
    }
    ctx.restore();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = th.text;
    ctx.font = 'bold 56px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.title, W / 2, 386);
    ctx.fillStyle = th.sub;
    ctx.font = '26px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.sub, W / 2, 428);
    ctx.save();                        // 优惠券标签行（虚线小票边框 · 黄字）
    var tags = d.tags || ['满300减80', '新客立减', '可叠加券'];
    var tw = 140, gap = 14;
    var total = tags.length * tw + (tags.length - 1) * gap;
    for (var t = 0; t < tags.length; t++) {
      var tx = (W - total) / 2 + t * (tw + gap);
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = hexA(th.price, 0.8);
      ctx.lineWidth = 1.5;
      roundRect(ctx, tx, 456, tw, 44, 8);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = th.price;
      ctx.font = 'bold 22px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(tags[t], tx + tw / 2, 479);
    }
    ctx.restore();
    ctx.fillStyle = th.price;         // 倒计时（动态）
    ctx.font = 'bold 32px "Courier New", monospace';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('距结束  ' + d.countdown, W / 2, 542);
    drawButton(ctx, (W - 320) / 2, 576, 320, 82, '立即参与', th);
    drawAdBadge(ctx, 24, 24);
    drawCloseBtn(ctx, W - 44, 44);
  },

  /* 3. 视频推荐（视频娱乐紫红 · 信息流）：热播榜 + 视频封面（含播放按钮）+ 分类标签 */
  recommendation: function (ctx, W, H, d) {
    var th = THEMES.video;
    ctx.fillStyle = hexA(th.accent, 0.55);      // 头像
    ctx.beginPath();
    ctx.arc(68, 68, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = th.text;
    ctx.font = 'bold 26px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('热播榜 · 为你挑选', 106, 60);
    ctx.fillStyle = th.sub;
    ctx.font = '20px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('根据你的观看记录生成', 106, 88);
    ctx.fillStyle = th.btnFill;                 // 关注按钮
    ctx.strokeStyle = th.btnStroke;
    ctx.lineWidth = 2;
    roundRect(ctx, W - 118, 46, 78, 40, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = '20px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('关注', W - 79, 67);
    ctx.textBaseline = 'alphabetic';
    drawPhoto(ctx, 36, 118, 262, 300, 'video', d.seed, th);              // 大封面（含播放按钮）
    drawPhoto(ctx, 314, 118, 162, 178, 'video', (d.seed || 0) + 1, th);  // 小封面
    drawPhoto(ctx, 314, 308, 162, 110, 'scene', (d.seed || 0) + 2, th);
    ctx.fillStyle = 'rgba(8,4,12,0.68)';        // 大封面底部压字条
    ctx.fillRect(36, 348, 262, 70);
    ctx.fillStyle = th.text;
    ctx.font = 'bold 24px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(d.items[0].title, 48, 380);
    ctx.fillStyle = th.sub;
    ctx.font = '19px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.items[0].sub + ' · 时长 03:12', 48, 404);
    ctx.fillStyle = th.text;                    // 小封面下文字
    ctx.font = 'bold 22px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.items[1].title, 36, 462);
    ctx.fillStyle = th.sub;
    ctx.font = '20px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.items[1].sub + ' · ' + d.items[2].sub, 36, 492);
    ctx.save();                                 // 分类标签行（粉描边胶囊）
    var cats = ['悬疑', '生活', '旅行'];
    for (var c = 0; c < 3; c++) {
      var cx = 44 + c * 96;
      ctx.strokeStyle = hexA(th.accent, 0.65);
      ctx.lineWidth = 1.5;
      roundRect(ctx, cx, 524, 82, 34, 17);
      ctx.stroke();
      ctx.fillStyle = th.accent;
      ctx.font = '18px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(cats[c], cx + 41, 542);
    }
    ctx.restore();
    drawButton(ctx, (W - 300) / 2, 576, 300, 76, '继续观看', th);
    drawAdBadge(ctx, W - 84, H - 54);
    drawCloseBtn(ctx, W - 32, 32);            // 内容推荐也提供关闭（放在最右上角）
  },

  /* 4. 应用安装广告（白底 · Google App Install 风格）：图标+名称+星级 /
        双应用截图 / 全宽安装按钮（进度填充） */
  download: function (ctx, W, H, d) {
    var th = d.th || THEMES.app;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#9aa3ad';                               // 顶部"广告"信息行（真实安装广告样式）
    ctx.font = '17px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('广告 · 应用推荐', 44, 54);
    var g = ctx.createLinearGradient(44, 76, 148, 180);      // 应用图标（主题渐变圆角方块）
    g.addColorStop(0, hexA(th.accent, 0.95));
    g.addColorStop(1, th.btnFill);
    ctx.fillStyle = g;
    roundRect(ctx, 44, 76, 104, 104, 26);
    ctx.fill();
    ctx.strokeStyle = hexA(th.btnStroke, 0.85);
    ctx.lineWidth = 3;
    roundRect(ctx, 44, 76, 104, 104, 26);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 50px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(d.glyph, 96, 130);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#1b1f26';                               // 名称（深色文字 · 白卡）
    ctx.font = 'bold 38px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.name, 172, 112);
    ctx.fillStyle = '#ffb800';                               // 星级 + 评分 + 下载量
    ctx.font = '22px sans-serif';
    var st = '';
    for (var i = 0; i < 5; i++) st += i < d.stars ? '★' : '☆';
    ctx.fillText(st, 172, 146);
    ctx.fillStyle = '#6b7480';
    ctx.font = '19px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('4.' + (d.stars % 5) + ' · ' + d.dl + ' 次下载 · ' + d.desc, 172, 176);
    drawAppShot(ctx, 44, 212, 218, 388, th, 0);              // 两张应用截图
    drawAppShot(ctx, 274, 212, 218, 388, th, 1);
    var bx = 44, bw = W - 88, by = 628, bh = 84;             // 全宽安装按钮（进度填充）
    if (d.progress >= 1) {
      drawButton(ctx, bx, by, bw, bh, '打开', th);
    } else if (d.progress > 0) {
      ctx.save();
      ctx.fillStyle = th.btnFill;
      ctx.strokeStyle = th.btnStroke;
      ctx.lineWidth = 3;
      roundRect(ctx, bx, by, bw, bh, 14);
      ctx.fill();
      ctx.stroke();
      ctx.save();
      roundRect(ctx, bx, by, bw, bh, 14);
      ctx.clip();
      ctx.fillStyle = hexA(th.accent, 0.55);
      ctx.fillRect(bx, by, bw * d.progress, bh);
      ctx.restore();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 30px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('安装中 ' + Math.round(d.progress * 100) + '%', W / 2, by + bh / 2);
      ctx.restore();
    } else {
      drawButton(ctx, bx, by, bw, bh, '安装', th);
    }
    ctx.fillStyle = '#9aa3ad';
    ctx.font = '17px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('包含应用内购买 · 安装即同意《用户协议》与《隐私政策》', W / 2, 738);
    drawCloseBtn(ctx, W - 44, 44);
  },

  /* 5. 跳转中间页（小型加载窗，悬浮在广告页前方）：加载圈 + 进度条（永远到不了 100%） */
  redirect: function (ctx, W, H, d) {
    ctx.save();                        // 旋转加载圈（动态）
    ctx.translate(W / 2, 190);
    ctx.rotate(d.spin || 0);
    ctx.strokeStyle = 'rgba(130,145,160,0.9)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(0, 0, 38, 0, Math.PI * 1.35);
    ctx.stroke();
    ctx.restore();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#e8e8e8';
    ctx.font = 'bold 42px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('正在打开…', W / 2, 322);
    ctx.fillStyle = '#8a919b';
    ctx.font = '22px "Courier New", monospace';
    ctx.fillText(d.url, W / 2, 364);
    drawProgressBar(ctx, 88, 408, W - 176, 13, d.progress || 0);
    ctx.fillStyle = 'rgba(138,145,155,0.7)';
    ctx.font = '19px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('即将跳转至合作页面 · 请稍候', W / 2, 456);
    drawCloseBtn(ctx, W - 42, 42);
  },

  /* 6. 连续弹窗（电商红橙 · 中型悬浮窗，压在前页上方）：商品图 + 优惠码 + 领取按钮 */
  popup: function (ctx, W, H, d) {
    var th = THEMES.shop;
    var t = d.appear != null ? Math.max(0, Math.min(1, d.appear)) : 1;  // 出现动画（一次性）
    ctx.save();
    ctx.globalAlpha = t;
    var s = 0.94 + 0.06 * t;
    ctx.translate(W / 2, H / 2);
    ctx.scale(s, s);
    ctx.translate(-W / 2, -H / 2);
    ctx.fillStyle = 'rgba(42,18,11,0.97)';   // 弹窗卡片（红橙主题底，几乎占满中型窗）
    ctx.strokeStyle = th.border;
    ctx.lineWidth = 3;
    roundRect(ctx, 30, 24, W - 60, H - 48, 20);
    ctx.fill();
    ctx.stroke();
    drawPhoto(ctx, 52, 48, W - 104, 300, 'product', d.variant || 0, th);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = th.text;
    ctx.font = 'bold 36px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.title, W / 2, 408);
    ctx.fillStyle = th.sub;
    ctx.font = '23px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.sub, W / 2, 444);
    ctx.setLineDash([6, 4]);           // 优惠码（虚线小票边框 · 黄字）
    ctx.strokeStyle = hexA(th.price, 0.85);
    ctx.lineWidth = 2;
    roundRect(ctx, W / 2 - 132, 470, 264, 52, 8);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = th.price;
    ctx.font = 'bold 26px "Courier New", monospace';
    ctx.fillText('CODE · SAVE' + d.code, W / 2, 504);
    drawButton(ctx, W / 2 - 132, 552, 264, 70, '领取优惠', th);
    ctx.restore();
    drawCloseBtn(ctx, W - 52, 42);     // 关闭按钮贴边（后续页面会挡住它）
    drawAdBadge(ctx, 24, 24);
  },

  /* 7. 横向通知条（系统样式 + 彩色应用图标）：图标 + 标题/摘要 + 时间 + 查看 */
  notification: function (ctx, W, H, d) {
    ctx.save();                        // 应用图标（按通知内容着色）
    ctx.fillStyle = d.color || '#5a8fd9';
    roundRect(ctx, 22, 26, 78, 78, 18);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 40px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(d.glyph, 61, 68);
    ctx.restore();
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#e8e8e8';
    ctx.font = 'bold 30px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.title, 122, 62);
    ctx.fillStyle = '#9aa0a8';
    ctx.font = '22px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.sub, 122, 98);
    ctx.fillStyle = 'rgba(138,145,155,0.7)';
    ctx.font = '18px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.time, 122, 132);
    drawButton(ctx, W - 240, 40, 140, 56, '查看', THEMES.system);
    drawCloseBtn(ctx, W - 52, 68);
    drawAdBadge(ctx, W - 200, H - 50);
  },

  /* 8. 横幅广告（白底 · Mobile Banner）：左侧场景图 + 中间文案价格 + 右端橙色 CTA，极扁比例 */
  banner: function (ctx, W, H, d) {
    var th = THEMES.bright;
    drawPhoto(ctx, 36, 32, 176, 176, 'scene', d.variant || 0, th);   // 左：场景/商品图
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#9aa3ad';                                       // "广告"来源行（真实 Banner 样式）
    ctx.font = '18px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('广告 · 云惠生活', 240, 66);
    ctx.fillStyle = '#1b1f26';
    ctx.font = 'bold 44px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.title, 240, 120);
    ctx.fillStyle = '#6b7480';
    ctx.font = '22px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.sub, 240, 156);
    ctx.fillStyle = '#ff4d3a';
    ctx.font = 'bold 32px sans-serif';
    ctx.fillText(d.amount + ' · ' + d.tags.join(' / '), 240, 198);
    ctx.save();                                                      // 右端 CTA（橙色胶囊按钮）
    ctx.fillStyle = '#ff7a1a';
    roundRect(ctx, W - 204, 82, 156, 76, 38);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('领取', W - 126, 122);
    ctx.restore();
    drawCloseBtn(ctx, W - 36, 36);
  },

  /* 9. 系统确认弹窗（克制深灰 · 与彩色商业广告形成区别）：即将离开页面 · 双按钮 */
  sysdialog: function (ctx, W, H, d) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#e8e8e8';
    ctx.font = 'bold 40px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('即将离开当前页面', W / 2, 120);
    ctx.fillStyle = '#9aa0a8';
    ctx.font = '24px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('将打开外部合作页面', W / 2, 172);
    ctx.strokeStyle = 'rgba(120,130,145,0.4)';     // URL 框
    ctx.lineWidth = 1.5;
    roundRect(ctx, 70, 200, W - 140, 48, 10);
    ctx.stroke();
    ctx.fillStyle = '#8a919b';
    ctx.font = '22px "Courier New", monospace';
    ctx.fillText(d.url, W / 2, 232);
    drawButton(ctx, 62, 300, 178, 80, '取消', THEMES.system);         // 弱按钮（左）
    drawButton(ctx, W - 240, 300, 178, 80, '继续前往', THEMES.system); // 强按钮（右）
    ctx.fillStyle = 'rgba(138,145,155,0.7)';
    ctx.font = '18px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('该操作无法撤销', W / 2, 430);
    drawCloseBtn(ctx, W - 44, 44);
  },

  /* 10. 游戏推广（紫蓝 + 金币 · 全屏主视觉）：角色场景大图 + 金色奖励角标 + 双按钮 */
  game: function (ctx, W, H, d) {
    var th = THEMES.game;
    drawPhoto(ctx, 0, 0, W, 380, 'game', d.variant || 0, th);   // 全宽游戏主视觉（含角色/金币）
    ctx.save();                        // 金色奖励角标（压在图底）
    ctx.fillStyle = th.gold;
    roundRect(ctx, 30, 316, 236, 46, 23);
    ctx.fill();
    ctx.fillStyle = '#3a2a00';
    ctx.font = 'bold 22px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(d.reward, 148, 340);
    ctx.restore();
    ctx.textAlign = 'left';            // 标题 / 副题（左对齐）
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = th.text;
    ctx.font = 'bold 46px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.title, 44, 452);
    ctx.fillStyle = th.sub;
    ctx.font = '24px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.sub, 44, 490);
    ctx.fillStyle = '#ffce3a';         // 评分 + 下载量
    ctx.font = '22px sans-serif';
    var st = '';
    for (var i = 0; i < 5; i++) st += i < d.stars ? '★' : '☆';
    ctx.fillText(st, 44, 526);
    ctx.fillStyle = th.sub;
    ctx.font = '20px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.dl, 160, 526);
    drawButton(ctx, 44, 556, 244, 82, '立即开玩', th);   // 主按钮：立即开玩
    ctx.save();                        // 次按钮：描边式"查看攻略"
    ctx.fillStyle = 'rgba(22,16,51,0.65)';
    ctx.strokeStyle = th.btnStroke;
    ctx.lineWidth = 2.5;
    roundRect(ctx, 304, 556, 164, 82, 14);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = th.text;
    ctx.font = 'bold 26px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('查看攻略', 386, 598);
    ctx.restore();
    drawAdBadge(ctx, W - 84, H - 54);
    drawCloseBtn(ctx, W - 40, 40);
  },

  /* 11. 生活服务（青绿 · 场景主导）：城市场景全出血 + 服务标签 + 橙色优惠大字 */
  life: function (ctx, W, H, d) {
    var th = THEMES.life;
    drawPhoto(ctx, 0, 0, W, 340, 'scene', d.seed || 0, th);     // 场景图全宽出血
    ctx.save();                        // 场景上的服务标签
    for (var i = 0; i < d.tags.length; i++) {
      ctx.fillStyle = 'rgba(6,20,17,0.78)';
      roundRect(ctx, 30, 28 + i * 44, 96, 34, 17);
      ctx.fill();
      ctx.fillStyle = th.accent;
      ctx.font = '18px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(d.tags[i], 78, 46 + i * 44);
    }
    ctx.restore();
    ctx.textAlign = 'left';            // 橙色优惠大字（视觉焦点）
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = th.accent2;
    ctx.font = 'bold 58px sans-serif';
    ctx.fillText(d.amount, 44, 428);
    ctx.fillStyle = th.text;           // 标题 / 副题
    ctx.font = 'bold 40px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.title, 44, 486);
    ctx.fillStyle = th.sub;
    ctx.font = '24px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.sub, 44, 522);
    drawButton(ctx, 44, 556, 260, 80, '立即领取', th);
    ctx.textAlign = 'right';           // 右下使用数据（不对称收尾）
    ctx.fillStyle = th.sub;
    ctx.font = '19px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('已领 128万+ 张', W - 44, 586);
    ctx.fillText('限时 · 先到先得', W - 44, 612);
    drawAdBadge(ctx, W - 84, H - 54);
    drawCloseBtn(ctx, W - 40, 40);
  },

  /* 12. 美妆时尚（玫瑰粉 · 大图留白）：居中排版 + 精致细线标签 + 奶油色产品图 */
  beauty: function (ctx, W, H, d) {
    var th = THEMES.beauty;
    drawPhoto(ctx, 96, 76, 320, 380, 'beauty', d.variant || 0, th);   // 产品大图（居中，留白多）
    ctx.save();                        // 细线描边标签（新品/热卖/限量）
    ctx.strokeStyle = th.accent;
    ctx.lineWidth = 1.5;
    roundRect(ctx, 44, 92, 78, 36, 18);
    ctx.stroke();
    ctx.fillStyle = th.accent;
    ctx.font = '20px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(d.tag, 83, 111);
    ctx.restore();
    ctx.textAlign = 'center';          // 居中排版（与其他广告的左对齐形成区别）
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = th.text;
    ctx.font = 'bold 40px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.name, W / 2, 522);
    ctx.fillStyle = th.sub;
    ctx.font = '24px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.desc, W / 2, 558);
    ctx.textAlign = 'left';            // 价格 + 按钮（一行排布）
    ctx.fillStyle = th.price;
    ctx.font = 'bold 42px sans-serif';
    ctx.fillText('¥' + d.price, 100, 636);
    ctx.fillStyle = hexA(th.sub, 0.7);
    ctx.font = '20px sans-serif';
    ctx.fillText('¥' + d.was, 210, 634);
    drawButton(ctx, W - 320, 596, 220, 68, '立即购买', th);
    drawAdBadge(ctx, 24, 24);
    drawCloseBtn(ctx, W - 40, 40);
  },

  /* 14. 视频广告（紫红 · 全出血封面 + 播放进度 + 跳过倒计时） */
  video: function (ctx, W, H, d) {
    var th = THEMES.video;
    drawPhoto(ctx, 0, 0, W, 430, 'video', d.variant || 0, th);   // 全出血封面（人物 + 播放按钮）
    var fade = ctx.createLinearGradient(0, 330, 0, 430);
    fade.addColorStop(0, 'rgba(8,4,12,0)');
    fade.addColorStop(1, 'rgba(8,4,12,0.8)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 330, W, 100);
    ctx.save();                                    // 跳过广告倒计时（左上胶囊）
    ctx.fillStyle = 'rgba(8,4,12,0.7)';
    roundRect(ctx, 24, 28, 172, 44, 22);
    ctx.fill();
    ctx.fillStyle = d.skip > 0 ? th.sub : th.accent2;
    ctx.font = 'bold 20px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(d.skip > 0 ? '跳过广告 ' + d.skip + 's' : '跳过 ✓', 110, 51);
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = th.text;
    ctx.font = 'bold 38px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.title, 44, 494);
    ctx.fillStyle = th.sub;
    ctx.font = '22px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.sub + ' · 来自 星火视频', 44, 532);
    drawProgressBar(ctx, 44, 568, W - 88, 10, d.progress || 0, th.accent);   // 播放进度（动态）
    var sec = Math.floor((d.progress || 0) * 30);
    ctx.fillStyle = th.sub;
    ctx.font = '18px "Courier New", monospace';
    ctx.fillText('00:' + (sec < 10 ? '0' : '') + sec + ' / 00:30', 44, 606);
    drawButton(ctx, 44, 630, 240, 72, '立即观看', th);
    ctx.textAlign = 'right';
    ctx.fillStyle = th.sub;
    ctx.font = '19px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('开通会员免广告', W - 44, 672);
    drawAdBadge(ctx, W - 84, H - 54);
    drawCloseBtn(ctx, W - 40, 40);
  },

  /* 15. 试玩广告（Playable · 紫蓝）：上方游戏区（接金币）+ 状态化底部（开始/得分/奖励） */
  playable: function (ctx, W, H, d) {
    var th = THEMES.game;
    var fx = 26, fy = 96, fw = W - 52, fh = 368;
    d.field = { x: fx, y: fy, w: fw, h: fh };      // 游戏区坐标（交互换算用）
    var by = fy + fh - 40;                         // 篮筐高度
    ctx.save();
    ctx.strokeStyle = hexA(th.accent, 0.55);
    ctx.lineWidth = 2;
    roundRect(ctx, fx, fy, fw, fh, 16);
    ctx.stroke();
    ctx.save();
    roundRect(ctx, fx, fy, fw, fh, 16);
    ctx.clip();
    var g = ctx.createLinearGradient(0, fy, 0, fy + fh);   // 夜空底
    g.addColorStop(0, th.photo[0]);
    g.addColorStop(1, '#0a0718');
    ctx.fillStyle = g;
    ctx.fillRect(fx, fy, fw, fh);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';               // 星星
    for (var s2 = 0; s2 < 20; s2++) {
      ctx.fillRect(fx + seededRand(s2 * 7 + 3) * fw, fy + seededRand(s2 * 13 + 1) * fh * 0.7, 2, 2);
    }
    for (var i = 0; i < d.coins.length; i++) {             // 掉落的金币
      var c = d.coins[i];
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(Math.sin(c.spin) * 0.4);
      ctx.fillStyle = th.gold;
      ctx.beginPath(); ctx.arc(0, 0, 17, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(58,42,0,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = th.accent;                             // 篮筐（跟随鼠标）
    roundRect(ctx, d.basketX - 46, by, 92, 26, 8);
    ctx.fill();
    ctx.strokeStyle = th.accent2;
    ctx.lineWidth = 2.5;
    roundRect(ctx, d.basketX - 52, by - 8, 104, 14, 7);
    ctx.stroke();
    ctx.fillStyle = 'rgba(10,8,20,0.7)';                   // 得分角标 + 时间条
    roundRect(ctx, fx + 12, fy + 12, 150, 40, 8);
    ctx.fill();
    ctx.fillStyle = th.gold;
    ctx.font = 'bold 22px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('金币 +' + d.score, fx + 28, fy + 33);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    roundRect(ctx, fx + 180, fy + 26, fw - 204, 12, 6);
    ctx.fill();
    ctx.fillStyle = th.accent2;
    roundRect(ctx, fx + 180, fy + 26, (fw - 204) * Math.min(1, d.playT / 8), 12, 6);
    ctx.fill();
    ctx.restore();
    ctx.textAlign = 'left';                                // 标题
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = th.text;
    ctx.font = 'bold 36px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('试玩 · 接住金币', 44, 58);
    ctx.fillStyle = th.sub;
    ctx.font = '20px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('完成试玩领 648 新手礼包', 44, 84);
    ctx.textAlign = 'center';                              // 底部：按状态切换
    if (d.state === 'ready') {
      ctx.fillStyle = th.text;
      ctx.font = 'bold 30px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText('点击游戏区开始试玩', W / 2, 512);
      ctx.save();                                          // 金色大按钮
      ctx.fillStyle = th.gold;
      ctx.strokeStyle = 'rgba(58,42,0,0.7)';
      ctx.lineWidth = 3;
      roundRect(ctx, (W - 260) / 2, 540, 260, 84, 16);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#3a2a00';
      ctx.font = 'bold 34px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText('点 击 开 始', W / 2, 583);
      ctx.restore();
      d.startBtn = { x: (W - 260) / 2, y: 540, w: 260, h: 84 };
      ctx.fillStyle = th.sub;
      ctx.font = '19px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('约 10 秒 · 随时退出', W / 2, 664);
    } else if (d.state === 'playing') {
      ctx.fillStyle = th.text;
      ctx.font = 'bold 40px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText('已接住 ' + (d.score / 10) + ' 枚金币', W / 2, 540);
      ctx.fillStyle = th.sub;
      ctx.font = '22px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText('移动鼠标控制篮筐', W / 2, 590);
    } else {
      ctx.fillStyle = th.text;
      ctx.font = 'bold 32px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText('恭喜完成试玩', W / 2, 502);
      ctx.fillStyle = th.gold;
      ctx.font = 'bold 58px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText('获得奖励 +50', W / 2, 566);
      drawButton(ctx, (W - 260) / 2, 598, 260, 78, '立即下载', th);
      d.dlBtn = { x: (W - 260) / 2, y: 598, w: 260, h: 78 };
      ctx.fillStyle = th.sub;
      ctx.font = '18px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText('奖励已存入账户 · 下载后可领取', W / 2, 706);
    }
    drawAdBadge(ctx, 24, 24);
    drawCloseBtn(ctx, W - 40, 40);
  },

  /* 16. 优惠券弹窗（红橙 · 票券打孔设计 · 领取状态变化 + 过期倒计时） */
  /* 16. 优惠券弹窗（白底票券 · Carrefour 风格）：红色票头带 + 大金额 + 打孔虚线 + 条码 + 倒计时 */
  coupon: function (ctx, W, H, d) {
    var t = d.appear != null ? Math.max(0, Math.min(1, d.appear)) : 1;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(0.92 + 0.08 * t, 0.92 + 0.08 * t);
    ctx.globalAlpha = t;
    ctx.translate(-W / 2, -H / 2);
    ctx.fillStyle = '#ffffff';                       // 票券主体（白）
    roundRect(ctx, 36, 26, W - 72, H - 60, 18);
    ctx.fill();
    ctx.save();                                      // 红色票头带（裁在票内）
    roundRect(ctx, 36, 26, W - 72, H - 60, 18);
    ctx.clip();
    ctx.fillStyle = '#e23a20';
    ctx.fillRect(36, 26, W - 72, 84);
    ctx.restore();
    ctx.fillStyle = '#ffffff';                       // 票头文字
    ctx.font = 'bold 30px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('限时优惠 · 新人专享', W / 2, 78);
    ctx.fillStyle = '#e23a20';                       // 左侧：大金额
    ctx.font = 'bold 92px sans-serif';
    ctx.fillText('¥' + d.amount, 168, 248);
    ctx.fillStyle = '#6b7480';
    ctx.font = '20px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('满 ' + d.min + ' 元可用 · 全场通用', 168, 286);
    var bx = 72;                                     // 左侧：条码（宽度随机竖条）
    for (var i = 0; i < 30; i++) {
      var bw2 = 2 + Math.floor(seededRand(i * 7 + d.amount) * 5);
      if (seededRand(i * 13 + d.amount) > 0.35) {
        ctx.fillStyle = '#1b1f26';
        ctx.fillRect(bx, 312, bw2, 62);
      }
      bx += bw2 + 5;
    }
    var dx = 306;                                    // 垂直打孔分隔（缺口半圆 + 虚线）
    ctx.fillStyle = '#f4f5f7';
    ctx.beginPath(); ctx.arc(dx, 26, 13, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(dx, H - 34, 13, 0, Math.PI * 2); ctx.fill();
    ctx.setLineDash([7, 7]);
    ctx.strokeStyle = 'rgba(226,58,32,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(dx, 42);
    ctx.lineTo(dx, H - 48);
    ctx.stroke();
    ctx.setLineDash([]);
    var rx = (dx + W - 36) / 2;                      // 右侧：券码 + 倒计时 + 按钮
    ctx.textAlign = 'center';
    ctx.fillStyle = '#1b1f26';
    ctx.font = 'bold 21px "Courier New", monospace';
    ctx.fillText('CODE·' + d.code, rx, 148);
    ctx.fillStyle = '#e23a20';
    ctx.font = 'bold 21px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.countdown + ' 后过期', rx, 184);
    var labels = ['立即领取', '已领取 ✓', '去使用'];   // 按钮状态（动态变化）
    ctx.save();
    ctx.fillStyle = '#e23a20';
    roundRect(ctx, dx + 22, 206, W - 36 - dx - 22, 64, 32);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 25px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(labels[d.state || 0], rx, 239);
    ctx.restore();
    ctx.fillStyle = '#9aa3ad';
    ctx.font = '16px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('领取后 15 分钟内有效', rx, 300);
    ctx.fillText('逾期作废 · 不可转赠', rx, 326);
    ctx.restore();
    drawCloseBtn(ctx, W - 40, 40);
  },

  /* 17. 原生信息流（浅灰 feed 底 + 白色内容卡 · 赞助大卡混在其中 · 角落极小"广告"标识） */
  native: function (ctx, W, H, d) {
    ctx.fillStyle = '#eef0f3';                        // feed 浅灰底
    roundRect(ctx, 8, 8, W - 16, H - 16, 20);
    ctx.fill();
    ctx.textAlign = 'left';                           // 顶部标题 + tabs
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#1b1f26';
    ctx.font = 'bold 34px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.head || '今日热门', 44, 64);
    var tabs = ['关注', '推荐', '附近'];
    for (var i = 0; i < 3; i++) {
      var tx = W - 96 - (2 - i) * 86;
      ctx.fillStyle = i === 1 ? '#2f6fed' : '#8a919b';
      ctx.font = (i === 1 ? 'bold ' : '') + '20px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(tabs[i], tx + 24, 60);
    }
    /* 内容卡（白 · 左文右图） */
    var it0 = d.items[(d.offset || 0) % d.items.length];
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, 32, 92, W - 64, 116, 14);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.fillStyle = '#1b1f26';
    ctx.font = 'bold 24px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(it0.title.length > 10 ? it0.title.slice(0, 10) + '…' : it0.title, 48, 138);
    ctx.fillStyle = '#8a919b';
    ctx.font = '18px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(it0.sub, 48, 174);
    drawPhoto(ctx, W - 172, 106, 124, 88, 'scene', (d.seed || 0), THEMES.bright);
    /* 赞助卡（本页真正的主角 · 大图 + 标题 + 来源 + "广告"标识 + CTA） */
    var ad = d.items[(1 + (d.offset || 0)) % d.items.length];
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, 32, 224, W - 64, 296, 14);
    ctx.fill();
    drawPhoto(ctx, 48, 240, W - 96, 168, 'scene', (d.seed || 0) + 1, THEMES.bright);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#1b1f26';
    ctx.font = 'bold 27px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(ad.title, 48, 448);
    ctx.fillStyle = '#8a919b';
    ctx.font = '18px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(ad.sub + ' · 赞助内容', 48, 478);
    ctx.fillStyle = '#c9cfd8';                        // 来源头像
    ctx.beginPath();
    ctx.arc(62, 500, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8a919b';
    ctx.font = '18px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('推广', 84, 506);
    ctx.save();                                       // CTA 蓝胶囊
    ctx.fillStyle = '#2f6fed';
    roundRect(ctx, W - 172, 482, 124, 44, 22);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('了解更多', W - 110, 504);
    ctx.restore();
    drawAdBadge(ctx, W - 118, 236);                   // 赞助卡角落极小"广告"标识
    /* 骨架卡（正在加载更多） */
    ctx.fillStyle = '#e2e6ec';
    roundRect(ctx, 32, 536, W - 64, 84, 14);
    ctx.fill();
    ctx.fillStyle = '#cdd4dd';
    roundRect(ctx, 48, 552, 200, 14, 7);
    ctx.fill();
    roundRect(ctx, 48, 578, 300, 12, 6);
    ctx.fill();
    drawCloseBtn(ctx, W - 34, 34);                    // 右上角小 ✕（信息流样式）
  },

  /* 18. 外卖（红橙 · 食物大图 + 配送信息 + 实时下单人数） */
  food: function (ctx, W, H, d) {
    var th = THEMES.shop;
    drawPhoto(ctx, 0, 0, W, 380, 'food', d.variant || 0, th);   // 全出血食物图
    ctx.save();                                     // 店铺角标（压图）
    ctx.fillStyle = 'rgba(24,9,5,0.85)';
    roundRect(ctx, 24, 26, 240, 48, 10);
    ctx.fill();
    ctx.fillStyle = th.text;
    ctx.font = 'bold 24px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(d.shop + ' · ★' + d.rating, 44, 51);
    ctx.restore();
    var fade = ctx.createLinearGradient(0, 300, 0, 380);
    fade.addColorStop(0, 'rgba(28,12,7,0)');
    fade.addColorStop(1, 'rgba(28,12,7,0.8)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 300, W, 80);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = th.text;
    ctx.font = 'bold 42px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.name, 44, 436);
    ctx.fillStyle = th.sub;
    ctx.font = '22px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.sales + ' · 预计 ' + d.eta + ' 分钟送达 · 配送费 ¥3', 44, 472);
    for (var i = 0; i < d.tags.length; i++) {       // 满减标签
      var tx = 44 + i * 132;
      ctx.strokeStyle = hexA(th.accent, 0.8);
      ctx.lineWidth = 1.5;
      roundRect(ctx, tx, 500, 120, 36, 18);
      ctx.stroke();
      ctx.fillStyle = th.accent;
      ctx.font = '18px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(d.tags[i], tx + 60, 519);
    }
    ctx.textAlign = 'right';                        // 实时下单人数（动态）
    ctx.fillStyle = th.sub;
    ctx.font = 'bold 21px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.buyers.toLocaleString() + ' 人正在下单', W - 44, 566);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = th.price;
    ctx.font = 'bold 48px sans-serif';
    ctx.fillText('¥' + d.price, 44, 612);
    ctx.fillStyle = 'rgba(255,220,190,0.5)';
    ctx.font = '22px sans-serif';
    ctx.fillText('¥' + d.was, 178, 608);
    drawButton(ctx, 44, 636, 220, 72, '去下单', th);
    ctx.textAlign = 'right';
    ctx.fillStyle = th.sub;
    ctx.font = '19px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('准时必达 · 超时赔付', W - 44, 678);
    drawAdBadge(ctx, W - 84, H - 54);
    drawCloseBtn(ctx, W - 40, 40);
  },

  /* 19. 旅游（湖蓝 · 目的地大图 + 价格 + 库存递减/限时倒计时） */
  travel: function (ctx, W, H, d) {
    var th = THEMES.travel;
    drawPhoto(ctx, 0, 0, W, 420, 'travel', d.seed || 0, th);    // 全出血目的地海报
    var fade = ctx.createLinearGradient(0, 320, 0, 420);
    fade.addColorStop(0, 'rgba(8,21,33,0)');
    fade.addColorStop(1, 'rgba(8,21,33,0.85)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 320, W, 100);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 52px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.dest, 44, 366);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '24px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.name, 44, 402);
    ctx.fillStyle = th.price;                       // 价格
    ctx.font = 'bold 54px sans-serif';
    ctx.fillText('¥' + d.price + ' 起', 44, 502);
    ctx.fillStyle = th.sub;
    ctx.font = '22px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('¥' + d.was + ' · 含往返机票 + 4 晚海景房', 44, 538);
    ctx.textAlign = 'right';                        // 库存（动态递减）+ 倒计时
    ctx.fillStyle = th.accent2;
    ctx.font = 'bold 28px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('仅剩 ' + d.stock + ' 间', W - 44, 500);
    ctx.fillStyle = th.sub;
    ctx.font = 'bold 22px "Courier New", monospace';
    ctx.fillText('距优惠结束 ' + d.countdown, W - 44, 538);
    drawButton(ctx, 44, 588, 250, 78, '立即抢购', th);
    ctx.textAlign = 'right';
    ctx.fillStyle = th.sub;
    ctx.font = '19px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('二次确认 · 未出行可退', W - 44, 644);
    drawAdBadge(ctx, 24, 24);
    drawCloseBtn(ctx, W - 40, 40);
  },

  /* 20. 全屏插页（Interstitial · 手机竖屏比例）：全出血主视觉 + 品牌胶囊 + 跳过倒计时
        + 折扣爆炸星 + 底部白色面板（商品信息 + 价格 + 大 CTA） */
  interstitial: function (ctx, W, H, d) {
    var th = THEMES.shop;
    drawPhoto(ctx, 8, 8, W - 16, 600, 'product', d.variant || 0, th);   // 全出血主视觉
    var g = ctx.createLinearGradient(0, 400, 0, 608);                    // 照片底部压暗（白字可读）
    g.addColorStop(0, 'rgba(10,4,2,0)');
    g.addColorStop(1, 'rgba(10,4,2,0.8)');
    ctx.save();
    roundRect(ctx, 8, 8, W - 16, 600, 12);
    ctx.clip();
    ctx.fillStyle = g;
    ctx.fillRect(8, 400, W - 16, 208);
    ctx.restore();
    ctx.save();                                            // 品牌胶囊（左上 · 真实开屏广告样式）
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    roundRect(ctx, 28, 28, 186, 44, 22);
    ctx.fill();
    ctx.fillStyle = '#e23a20';
    ctx.font = 'bold 21px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('广告 · ' + d.brand, 121, 51);
    ctx.restore();
    ctx.save();                                            // 折扣爆炸星（多角星 + 折扣大字）
    var cx = 116, cy = 540, R1 = 78, R2 = 56;
    ctx.fillStyle = '#ffd23a';
    ctx.beginPath();
    for (var i = 0; i < 16; i++) {
      var ang = (Math.PI * 2 * i) / 16 - Math.PI / 2;
      var rr = i % 2 === 0 ? R1 : R2;
      var px = cx + Math.cos(ang) * rr, py = cy + Math.sin(ang) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#a02200';
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(d.off + '折', cx, cy);
    ctx.restore();
    ctx.save();                                            // 跳过倒计时（照片右下）
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    roundRect(ctx, W - 176, 548, 148, 42, 21);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = '19px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('跳过 ' + (d.skip != null ? d.skip : 5), W - 102, 570);
    ctx.restore();
    /* 底部白色面板：商品信息 + 价格 + 大 CTA */
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, 8, 606, W - 16, 250, 14);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#1b1f26';
    ctx.font = 'bold 36px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.name, 40, 668);
    ctx.fillStyle = '#6b7480';
    ctx.font = '21px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.desc, 40, 702);
    ctx.fillStyle = '#ff4d3a';
    ctx.font = 'bold 52px sans-serif';
    ctx.fillText('¥' + d.price, 40, 778);
    var wl = ctx.measureText('¥' + d.price).width;         // 原价划线
    ctx.fillStyle = '#9aa3ad';
    ctx.font = '24px sans-serif';
    ctx.fillText('¥' + d.was, 52 + wl, 778);
    ctx.strokeStyle = '#9aa3ad';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(44 + wl, 766);
    ctx.lineTo(56 + wl + ctx.measureText('¥' + d.was).width, 766);
    ctx.stroke();
    ctx.save();                                            // CTA 大按钮（橙色渐变胶囊）
    var gbtn = ctx.createLinearGradient(0, 736, 0, 828);
    gbtn.addColorStop(0, '#ff8a2a');
    gbtn.addColorStop(1, '#e23a20');
    ctx.fillStyle = gbtn;
    roundRect(ctx, 292, 736, 180, 92, 46);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 32px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('立即抢购', 382, 782);
    ctx.restore();
    ctx.fillStyle = '#9aa3ad';
    ctx.font = '17px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('已有 2.3万+ 人抢购 · 数量有限', 40, 828);
    drawCloseBtn(ctx, W - 40, 44);
  },

  /* 21. 中奖弹窗（YOU WON · 整个广告系统里最夸张、最具诱导性的一页）：
        旋转放射光芒 + 下落纸屑 + 金色脉冲大字 + 三礼盒 + 过期倒计时条 + 滚动中奖名单
        视觉逻辑参考 Virginia Lottery "YOU WON" 与早期 Congratulations 弹窗 */
  youwon: function (ctx, W, H, d) {
    /* 底：径向渐变紫 */
    var rg = ctx.createRadialGradient(W / 2, H * 0.34, 50, W / 2, H * 0.5, 560);
    rg.addColorStop(0, '#4a1470');
    rg.addColorStop(1, '#150426');
    ctx.fillStyle = rg;
    roundRect(ctx, 8, 8, W - 16, H - 16, 20);
    ctx.fill();
    ctx.save();
    roundRect(ctx, 8, 8, W - 16, H - 16, 20);
    ctx.clip();
    var cx = W / 2;
    /* 旋转放射光芒 */
    ctx.save();
    ctx.translate(cx, H * 0.36);
    ctx.rotate(d.rays || 0);
    ctx.fillStyle = 'rgba(255,210,58,0.10)';
    for (var i = 0; i < 12; i++) {
      ctx.rotate(Math.PI / 6);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(700, -70);
      ctx.lineTo(700, 70);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    /* 彩带纸屑（下落 + 翻转） */
    var cf = d.confetti || [];
    for (var f = 0; f < cf.length; f++) {
      var c = cf[f];
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.fillStyle = c.c;
      ctx.fillRect(-5, -9, 10, 18);
      ctx.restore();
    }
    /* 顶部徽章：WINNER */
    ctx.save();
    ctx.shadowColor = 'rgba(255,210,58,0.9)';
    ctx.shadowBlur = 26;
    ctx.fillStyle = '#ffd23a';
    ctx.beginPath();
    ctx.arc(cx, 96, 52, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#7a3c00';
    ctx.font = 'bold 28px "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('WINNER', cx, 97);
    /* 主标题：金色渐变 + 脉冲缩放 */
    var pu = 1 + 0.05 * (d.pulse || 0);
    ctx.save();
    ctx.translate(cx, 208);
    ctx.scale(pu, pu);
    var tg = ctx.createLinearGradient(0, -34, 0, 34);
    tg.addColorStop(0, '#fff3b0');
    tg.addColorStop(0.5, '#ffd23a');
    tg.addColorStop(1, '#ff9d1c');
    ctx.fillStyle = tg;
    ctx.strokeStyle = '#7a3c00';
    ctx.lineWidth = 3;
    ctx.font = 'bold 56px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(255,210,58,0.55)';
    ctx.shadowBlur = 18;
    ctx.strokeText('恭喜你中大奖!', 0, 0);
    ctx.fillText('恭喜你中大奖!', 0, 0);
    ctx.restore();
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#d9b8f0';
    ctx.font = '21px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('您是本区第 ' + (d.visitors || '8,675,312') + ' 位幸运访客', cx, 262);
    /* 三个礼盒（轻浮动 · "选一个领取"） */
    var boxes = [
      { x: cx - 152, c: '#e23a5c' },
      { x: cx,       c: '#2f6fed' },
      { x: cx + 152, c: '#17b06a' }
    ];
    var tt = d.t || 0;
    for (var b = 0; b < 3; b++) {
      var bx2 = boxes[b].x, by2 = 330 + Math.sin(tt * 2.4 + b * 2.1) * 7;
      ctx.save();
      ctx.translate(bx2, by2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(0, 66, 46, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = boxes[b].c;
      roundRect(ctx, -46, -40, 92, 104, 10);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.fillRect(-9, -40, 18, 104);            // 丝带（竖）
      ctx.fillRect(-46, -8, 92, 16);             // 丝带（横）
      ctx.fillStyle = '#ffd23a';
      ctx.font = 'bold 40px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', 0, 16);
      ctx.restore();
    }
    ctx.fillStyle = '#d9b8f0';
    ctx.font = '21px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('选择一个礼盒 · 立即开奖', cx, 448);
    /* 过期倒计时（红色收缩条） */
    var frac = (d.seconds != null ? d.seconds : 299) / 300;
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    roundRect(ctx, 96, 474, W - 192, 16, 8);
    ctx.fill();
    ctx.fillStyle = '#ff3d5a';
    roundRect(ctx, 96, 474, Math.max(10, (W - 192) * frac), 16, 8);
    ctx.fill();
    ctx.fillStyle = '#ffb8d8';
    ctx.font = 'bold 20px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('奖励 ' + (d.countdown || '04:59') + ' 后过期 · 过期作废', cx, 522);
    /* 大按钮：金色渐变 + 光泽扫过 */
    ctx.save();
    var gbtn = ctx.createLinearGradient(0, 548, 0, 648);
    gbtn.addColorStop(0, '#ffe27a');
    gbtn.addColorStop(1, '#ff9d1c');
    ctx.fillStyle = gbtn;
    roundRect(ctx, 96, 548, W - 192, 100, 50);
    ctx.fill();
    ctx.strokeStyle = '#fff3b0';
    ctx.lineWidth = 3;
    roundRect(ctx, 96, 548, W - 192, 100, 50);
    ctx.stroke();
    roundRect(ctx, 96, 548, W - 192, 100, 50);
    ctx.clip();
    var sx = 96 + (d.sweep || 0) * (W - 96);
    var sg = ctx.createLinearGradient(sx - 50, 0, sx + 50, 0);
    sg.addColorStop(0, 'rgba(255,255,255,0)');
    sg.addColorStop(0.5, 'rgba(255,255,255,0.55)');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(sx - 60, 548, 120, 100);
    ctx.restore();
    ctx.fillStyle = '#7a3c00';
    ctx.font = 'bold 38px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('立即领取 ¥888 红包', cx, 598);
    /* 滚动中奖名单 */
    var winners = d.winners || ['138****5678', '159****2381', '186****9024'];
    var prizes = ['智能平板', '扫地机器人', '888 元红包', '蓝牙耳机', '电饭煲'];
    var wi = d.tickerIdx || 0;
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    roundRect(ctx, 72, 676, W - 144, 46, 23);
    ctx.fill();
    ctx.fillStyle = '#e9d5ff';
    ctx.font = '19px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(winners[wi % winners.length] + ' 刚刚获得了 ' + prizes[wi % prizes.length], cx, 699);
    ctx.restore();   // 结束整页裁剪
    drawCloseBtn(ctx, W - 34, H - 34);   // 右下角小 ✕（真实中奖弹窗的关闭总是最难找）
  },

  /* 25. 多领域"恭喜中奖"动态广告（版式同 youwon · 每领域独立色系 PRIZE_PALETTES）：
        径向渐变底 + 旋转光芒 + 纸屑 + 徽章 + 渐变脉冲标题 +
        过期收缩条 + 渐变光泽大按钮 + 中奖名单滚动。
        中部主视觉：boxes 礼盒三选一 / ticket 票券卡 / big 大字金额 */
  prize: function (ctx, W, H, d) {
    var cfg = d.cfg, P = cfg.pal, cx = W / 2;
    /* 底：领域色系径向渐变 */
    var rg = ctx.createRadialGradient(cx, H * 0.34, 50, cx, H * 0.5, 560);
    rg.addColorStop(0, P.bgIn);
    rg.addColorStop(1, P.bgOut);
    ctx.fillStyle = rg;
    roundRect(ctx, 8, 8, W - 16, H - 16, 20);
    ctx.fill();
    ctx.save();
    roundRect(ctx, 8, 8, W - 16, H - 16, 20);
    ctx.clip();
    /* 旋转放射光芒 */
    ctx.save();
    ctx.translate(cx, H * 0.36);
    ctx.rotate(d.rays || 0);
    ctx.fillStyle = P.ray;
    for (var i = 0; i < 12; i++) {
      ctx.rotate(Math.PI / 6);
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(700, -70); ctx.lineTo(700, 70);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    /* 彩带纸屑（下落 + 翻转 · 领域配色） */
    var cf = d.confetti || [];
    for (var f = 0; f < cf.length; f++) {
      var c = cf[f];
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.fillStyle = c.c;
      ctx.fillRect(-5, -9, 10, 18);
      ctx.restore();
    }
    /* 顶部徽章：A=圆徽 B=角标 C=通栏 */
    var lay = cfg.layout || 'A';
    if (lay === 'A') {
    ctx.save();
    ctx.shadowColor = P.tGlow;
    ctx.shadowBlur = 26;
    ctx.fillStyle = P.badge;
    ctx.beginPath();
    ctx.arc(cx, 96, 52, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = P.badgeText;
    ctx.font = 'bold 30px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(cfg.badge, cx, 97);
    } else if (lay === 'B') { ctx.save(); ctx.fillStyle = P.badge; roundRect(ctx, 40, 44, 128, 54, 12); ctx.fill(); ctx.strokeStyle = P.btnStroke; ctx.lineWidth = 2; roundRect(ctx, 40, 44, 128, 54, 12); ctx.stroke(); ctx.restore(); ctx.fillStyle = P.badgeText; ctx.font = 'bold 28px "PingFang SC","Microsoft YaHei",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(cfg.badge, 104, 72); } else { var st = ctx.createLinearGradient(0, 8, W, 104); st.addColorStop(0, P.btn1); st.addColorStop(1, P.btn2); ctx.fillStyle = st; roundRect(ctx, 8, 8, W - 16, 96, 18); ctx.fill(); ctx.fillStyle = P.btnText; ctx.font = 'bold 32px "PingFang SC","Microsoft YaHei",sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(cfg.badge, 52, 57);
ctx.textAlign = 'right'; ctx.font = 'bold 20px "PingFang SC","Microsoft YaHei",sans-serif'; ctx.fillText('今日限定', W - 52, 57); }
    /* 主标题：领域色渐变 + 脉冲缩放 */
    var pu = 1 + 0.05 * (d.pulse || 0);
    ctx.save();
    ctx.translate(cx, lay === 'C' ? 252 : 208);
    ctx.scale(pu, pu);
    var tg = ctx.createLinearGradient(0, -34, 0, 34);
    tg.addColorStop(0, P.t1);
    tg.addColorStop(0.5, P.t2);
    tg.addColorStop(1, P.t3);
    ctx.fillStyle = tg;
    ctx.strokeStyle = P.tStroke;
    ctx.lineWidth = 3;
    ctx.font = 'bold 50px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = P.tGlow;
    ctx.shadowBlur = 18;
    ctx.strokeText(cfg.title, 0, 0);
    ctx.fillText(cfg.title, 0, 0);
    ctx.restore();
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = P.sub;
    ctx.font = '21px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(cfg.subPrefix + ' ' + d.visitors + ' ' + cfg.subSuffix, cx, lay === 'C' ? 306 : 262);
    /* 中部主视觉：按领域 mode */
    var tt = d.t || 0;
    if (cfg.mode === 'boxes') {
      /* 三个礼盒（轻浮动 · "选一个领取"） */
      var boxes = [
        { x: cx - 152, c: P.boxes[0] },
        { x: cx,       c: P.boxes[1] },
        { x: cx + 152, c: P.boxes[2] }
      ];
      for (var b = 0; b < 3; b++) {
        var bx2 = boxes[b].x, by2 = 330 + Math.sin(tt * 2.4 + b * 2.1) * 7;
        ctx.save();
        ctx.translate(bx2, by2);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.ellipse(0, 66, 46, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = boxes[b].c;
        roundRect(ctx, -46, -40, 92, 104, 10);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.fillRect(-9, -40, 18, 104);
        ctx.fillRect(-46, -8, 92, 16);
        ctx.fillStyle = '#ffd23a';
        ctx.font = 'bold 40px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', 0, 16);
        ctx.restore();
      }
    } else if (cfg.mode === 'ticket') {
      /* 票券卡：领域色卡片 + 主题色边 + 竖虚线（优惠券版式） */
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 18;
      ctx.fillStyle = P.card;
      roundRect(ctx, 86, 296, W - 172, 140, 16);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = P.cardBorder;
      ctx.lineWidth = 3;
      roundRect(ctx, 86, 296, W - 172, 140, 16);
      ctx.stroke();
      ctx.fillStyle = P.accent;
      ctx.font = 'bold 64px "Arial Black", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(cfg.amount, 86 + (W - 172) * 0.32, 296 + 74);
      ctx.save();
      ctx.setLineDash([8, 7]);
      ctx.strokeStyle = P.accent;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(86 + (W - 172) * 0.62, 312);
      ctx.lineTo(86 + (W - 172) * 0.62, 420);
      ctx.stroke();
      ctx.restore();
      var tx = 86 + (W - 172) * 0.81;
      ctx.fillStyle = '#1b1f26';
      ctx.font = 'bold 22px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText(cfg.unit, tx, 336);
      ctx.fillStyle = '#6b7480';
      ctx.font = '17px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText('今日有效 · 逾期作废', tx, 372);
      ctx.fillStyle = P.accent;
      ctx.font = 'bold 18px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText('点击立即使用', tx, 406);
    } else {
      /* 大字金额：领域色渐变 + 辉光 */
      ctx.save();
      ctx.shadowColor = P.tGlow;
      ctx.shadowBlur = 30;
      var ag = ctx.createLinearGradient(0, 300, 0, 420);
      ag.addColorStop(0, P.t1);
      ag.addColorStop(0.5, P.t2);
      ag.addColorStop(1, P.t3);
      ctx.fillStyle = ag;
      ctx.font = 'bold 116px "Arial Black", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(cfg.amount, cx, 360);
      ctx.restore();
      ctx.fillStyle = P.sub;
      ctx.font = '24px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText(cfg.unit, cx, 436);
    }
    ctx.fillStyle = P.sub;
    ctx.font = '21px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(cfg.pickHint, cx, 460);
    /* 过期倒计时（红色收缩条 · 各领域通用的紧迫语言） */
    var frac = (d.seconds != null ? d.seconds : 299) / 300;
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    roundRect(ctx, 96, 482, W - 192, 16, 8);
    ctx.fill();
    ctx.fillStyle = '#ff3d5a';
    roundRect(ctx, 96, 482, Math.max(10, (W - 192) * frac), 16, 8);
    ctx.fill();
    ctx.fillStyle = P.expire;
    ctx.font = 'bold 20px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('奖励 ' + (d.countdown || '04:59') + ' 后过期 · 过期作废', cx, 530);
    /* 大按钮：领域色渐变 + 光泽扫过 */
    ctx.save();
    var gbtn = ctx.createLinearGradient(0, 556, 0, 656);
    gbtn.addColorStop(0, P.btn1);
    gbtn.addColorStop(1, P.btn2);
    ctx.fillStyle = gbtn;
    roundRect(ctx, 96, 556, W - 192, 100, 50);
    ctx.fill();
    ctx.strokeStyle = P.btnStroke;
    ctx.lineWidth = 3;
    roundRect(ctx, 96, 556, W - 192, 100, 50);
    ctx.stroke();
    roundRect(ctx, 96, 556, W - 192, 100, 50);
    ctx.clip();
    var sx = 96 + (d.sweep || 0) * (W - 96);
    var sg = ctx.createLinearGradient(sx - 50, 0, sx + 50, 0);
    sg.addColorStop(0, 'rgba(255,255,255,0)');
    sg.addColorStop(0.5, 'rgba(255,255,255,0.55)');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(sx - 60, 556, 120, 100);
    ctx.restore();
    ctx.fillStyle = P.btnText;
    ctx.font = 'bold 36px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(cfg.btn, cx, 606);
    /* 滚动中奖名单（领域专属奖品） */
    var wi2 = d.tickerIdx || 0;
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    roundRect(ctx, 72, 684, W - 144, 46, 23);
    ctx.fill();
    ctx.fillStyle = P.tickText;
    ctx.font = '19px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(d.winners[wi2 % d.winners.length] + ' 刚刚获得了 ' + cfg.prizes[wi2 % cfg.prizes.length], cx, 713);
    ctx.restore();   // 结束整页裁剪
    drawCloseBtn(ctx, W - 34, H - 34);   // 右下角小 ✕（关闭总是最难找）
  },

  /* 22. 真实素材图片广告（assets/images/ · popup / fullPage 共用绘制器）：
        素材图整幅 contain 居中（不裁切真实广告内容）
        + 左上"广告"标识 + 右上 ✕（点了也不关，只会跳转）
        三态处理：ok=显示图片 / loading=加载提示 / error=红色错误提示（永不黑屏） */
  imgad: function (ctx, W, H, d) {
    ctx.save();
    roundRect(ctx, 8, 8, W - 16, H - 16, 18);
    ctx.clip();
    ctx.fillStyle = '#08090c';
    ctx.fillRect(0, 0, W, H);
    var rec = loadAdImage(d.src);
    if (rec.status === 'ok' && rec.img) {
      var s = Math.min((W - 20) / rec.img.width, (H - 20) / rec.img.height);
      var iw = rec.img.width * s, ih = rec.img.height * s;
      ctx.drawImage(rec.img, (W - iw) / 2, (H - ih) / 2, iw, ih);
    } else if (rec.status === 'error') {
      drawPhoto(ctx, 20, 20, W - 40, H - 40, 'abstract', d.seed || 0, THEMES.system);
      ctx.fillStyle = '#e06a5a';
      ctx.font = 'bold 26px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('素材加载失败', W / 2, H / 2 - 18);
      ctx.fillStyle = '#9aa0a8';
      ctx.font = '18px "Courier New", monospace';
      ctx.fillText(d.src, W / 2, H / 2 + 20);
    } else {
      ctx.fillStyle = '#55585f';
      ctx.font = '22px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('正在加载……', W / 2, H / 2);
    }
    ctx.restore();
    drawAdBadge(ctx, 24, 24);
    drawCloseBtn(ctx, W - 40, 40);
  },

  /* 23. 金币雨红包弹窗（紫金 · 仿素材弹窗 · 视觉朝 jackpot 靠拢）：
          旋转放射光芒 + 下落金币 + 脉冲金色标题 + 过期收缩条 + 金色渐变大按钮 */
  goldpop: function (ctx, W, H, d) {
    var rg = ctx.createRadialGradient(W / 2, H * 0.4, 40, W / 2, H * 0.5, 480);
    rg.addColorStop(0, '#4a1470');
    rg.addColorStop(1, '#150426');
    ctx.fillStyle = rg;
    roundRect(ctx, 8, 8, W - 16, H - 16, 18);
    ctx.fill();
    ctx.save();
    roundRect(ctx, 8, 8, W - 16, H - 16, 18);
    ctx.clip();
    ctx.save();                                          // 旋转放射光芒
    ctx.translate(W / 2, H * 0.34);
    ctx.rotate(d.rays || 0);
    ctx.fillStyle = 'rgba(255,210,58,0.10)';
    for (var i = 0; i < 12; i++) {
      ctx.rotate(Math.PI / 6);
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(560, -60); ctx.lineTo(560, 60);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    var coins = d.coins || [];                           // 下落金币
    for (var c = 0; c < coins.length; c++) {
      var k = coins[c];
      ctx.save();
      ctx.translate(k.x, k.y);
      ctx.rotate(k.rot);
      ctx.fillStyle = '#ffd23a';
      ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(58,42,0,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    var pu = 1 + 0.05 * (d.pulse || 0);                  // 脉冲金色标题
    ctx.save();
    ctx.translate(W / 2, 148);
    ctx.scale(pu, pu);
    var tg = ctx.createLinearGradient(0, -34, 0, 34);
    tg.addColorStop(0, '#fff3b0'); tg.addColorStop(0.5, '#ffd23a'); tg.addColorStop(1, '#ff9d1c');
    ctx.fillStyle = tg;
    ctx.font = 'bold 46px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('恭喜获得新人红包', 0, 0);
    ctx.restore();
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffd23a';                           // 金额大字
    ctx.font = 'bold 104px "Arial Black", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('¥' + d.amount, W / 2, 334);
    var frac = (d.seconds != null ? d.seconds : 59) / 59;    // 过期收缩条
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    roundRect(ctx, 106, 388, W - 212, 14, 7); ctx.fill();
    ctx.fillStyle = '#ff3d5a';
    roundRect(ctx, 106, 388, Math.max(8, (W - 212) * frac), 14, 7); ctx.fill();
    ctx.fillStyle = '#ffb8d8';
    ctx.font = 'bold 20px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('红包 ' + (d.countdown || '00:59') + ' 后过期 · 过期作废', W / 2, 436);
    var gbtn = ctx.createLinearGradient(0, 462, 0, 562);    // 金色渐变大按钮 + 光泽
    gbtn.addColorStop(0, '#ffe27a'); gbtn.addColorStop(1, '#ff9d1c');
    ctx.fillStyle = gbtn;
    roundRect(ctx, 96, 462, W - 192, 100, 50); ctx.fill();
    ctx.strokeStyle = '#fff3b0'; ctx.lineWidth = 3;
    roundRect(ctx, 96, 462, W - 192, 100, 50); ctx.stroke();
    ctx.save();
    roundRect(ctx, 96, 462, W - 192, 100, 50); ctx.clip();
    var sx = 96 + (d.sweep || 0) * W;
    var sg = ctx.createLinearGradient(sx - 50, 0, sx + 50, 0);
    sg.addColorStop(0, 'rgba(255,255,255,0)');
    sg.addColorStop(0.5, 'rgba(255,255,255,0.55)');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(sx - 60, 462, 120, 100);
    ctx.restore();
    ctx.fillStyle = '#7a3c00';
    ctx.font = 'bold 36px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('立即提现到钱包', W / 2, 512);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#d9b8f0';
    ctx.font = '17px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('已有 1,204,392 人成功提现', W / 2, 600);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    roundRect(ctx, 72, 622, W - 144, 42, 21); ctx.fill();
    ctx.fillStyle = '#e9d5ff';
    ctx.font = '16px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('提现需完成 3 个任务 · 剩余 2 个', W / 2, 648);
    ctx.restore();
    drawAdBadge(ctx, 24, 24);
    drawCloseBtn(ctx, W - 40, 40);
  },

  /* 24. 幸运大转盘（紫金 · 仿素材弹窗 · 视觉朝 jackpot 靠拢）：
          八扇转盘 + 金色指针 + 可交互抽奖（点击转动 → 出结果 → 领取进下一层） */
  spin: function (ctx, W, H, d) {
    var rg = ctx.createRadialGradient(W / 2, H * 0.42, 40, W / 2, H * 0.5, 480);
    rg.addColorStop(0, '#4a1470');
    rg.addColorStop(1, '#150426');
    ctx.fillStyle = rg;
    roundRect(ctx, 8, 8, W - 16, H - 16, 18);
    ctx.fill();
    ctx.save();
    roundRect(ctx, 8, 8, W - 16, H - 16, 18);
    ctx.clip();
    ctx.save();                                          // 缓慢旋转的放射光芒
    ctx.translate(W / 2, H * 0.46);
    ctx.rotate((d.rays || 0) * 0.3);
    ctx.fillStyle = 'rgba(255,210,58,0.08)';
    for (var i = 0; i < 12; i++) {
      ctx.rotate(Math.PI / 6);
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(560, -60); ctx.lineTo(560, 60);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    var tg = ctx.createLinearGradient(0, 50, 0, 116);    // 金色渐变标题
    tg.addColorStop(0, '#fff3b0'); tg.addColorStop(0.5, '#ffd23a'); tg.addColorStop(1, '#ff9d1c');
    ctx.fillStyle = tg;
    ctx.font = 'bold 50px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('幸运大转盘 · 100% 中奖', W / 2, 112);
    var cx = W / 2, cy = 356, R = 168;                   // 八扇转盘
    var seg = Math.PI * 2 / d.prizes.length;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(d.angle || 0);
    for (var s2 = 0; s2 < d.prizes.length; s2++) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R, s2 * seg - Math.PI / 2 - seg / 2, (s2 + 1) * seg - Math.PI / 2 - seg / 2);
      ctx.closePath();
      ctx.fillStyle = s2 % 2 ? '#3d1465' : '#6a2ea0';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,210,58,0.7)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.save();                                        // 扇区奖品文字（沿半径）
      ctx.rotate(s2 * seg);
      ctx.fillStyle = '#ffd23a';
      ctx.font = 'bold 21px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(d.prizes[s2], 0, -R + 42);
      ctx.restore();
    }
    ctx.restore();
    ctx.strokeStyle = '#ffd23a';                          // 转盘金边 + 中心轴
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    var hg = ctx.createLinearGradient(cx - 40, cy - 40, cx + 40, cy + 40);
    hg.addColorStop(0, '#ffe27a'); hg.addColorStop(1, '#ff9d1c');
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(cx, cy, 34, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#7a3c00';
    ctx.font = 'bold 24px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('GO', cx, cy + 1);
    ctx.fillStyle = '#ff3d5a';                            // 金色指针（指向正上方）
    ctx.beginPath();
    ctx.moveTo(cx - 16, cy - R - 14);
    ctx.lineTo(cx + 16, cy - R - 14);
    ctx.lineTo(cx, cy - R + 22);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#fff3b0';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.textBaseline = 'alphabetic';
    if (d.state === 'result') {                           // 结果：大字 + 领取按钮
      ctx.fillStyle = '#ffd23a';
      ctx.font = 'bold 40px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText('恭喜抽中 · ' + d.prize, W / 2, 566);
      var bg2 = ctx.createLinearGradient(0, 584, 0, 664);
      bg2.addColorStop(0, '#ffe27a'); bg2.addColorStop(1, '#ff9d1c');
      ctx.fillStyle = bg2;
      roundRect(ctx, (W - 260) / 2, 584, 260, 80, 40); ctx.fill();
      ctx.strokeStyle = '#fff3b0'; ctx.lineWidth = 3;
      roundRect(ctx, (W - 260) / 2, 584, 260, 80, 40); ctx.stroke();
      ctx.fillStyle = '#7a3c00';
      ctx.font = 'bold 30px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText('领取奖励', W / 2, 624);
      d.drawBtn = { x: (W - 260) / 2, y: 584, w: 260, h: 80 };
    } else {                                              // 待抽奖：立即抽奖按钮
      var bg3 = ctx.createLinearGradient(0, 584, 0, 664);
      bg3.addColorStop(0, '#ffe27a'); bg3.addColorStop(1, '#ff9d1c');
      ctx.fillStyle = bg3;
      roundRect(ctx, (W - 260) / 2, 584, 260, 80, 40); ctx.fill();
      ctx.strokeStyle = '#fff3b0'; ctx.lineWidth = 3;
      roundRect(ctx, (W - 260) / 2, 584, 260, 80, 40); ctx.stroke();
      ctx.fillStyle = '#7a3c00';
      ctx.font = 'bold 30px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(d.state === 'spinning' ? '转动中…' : '立即抽奖', W / 2, 624);
      d.drawBtn = { x: (W - 260) / 2, y: 584, w: 260, h: 80 };
    }
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#d9b8f0';
    ctx.font = '16px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('今日剩余 3 次免费抽奖机会', W / 2, 682);
    ctx.restore();
    drawAdBadge(ctx, 24, 24);
    drawCloseBtn(ctx, W - 40, 40);
  },

  /* 紧急呼救页：高对比红调，位置尺寸独立，永不参与错位/拥挤计算 */
  emergency: function (ctx, W, H, d) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#c07a7a';
    ctx.font = '22px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('SOS · 应急通道', W / 2, 90);
    ctx.fillStyle = '#faecec';
    ctx.font = 'bold 64px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.title, W / 2, 230);
    ctx.fillStyle = '#d8b0b0';
    ctx.font = '30px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(d.content, W / 2, 300);
    ctx.save();
    ctx.fillStyle = '#8c3539';
    ctx.strokeStyle = '#d47c7c';
    ctx.lineWidth = 4;
    roundRect(ctx, (W - 320) / 2, 430, 320, 88, 14);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 38px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(d.button, W / 2, 476);
    ctx.restore();
    ctx.strokeStyle = 'rgba(220,140,140,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(60, H - 60);
    ctx.lineTo(W - 60, H - 60);
    ctx.stroke();
  }
};

/* ============================================================
   2.6 页面内部动态（克制、低频；只保留最新 3 层，深层自动冻结）
   ============================================================ */

var activeDynamics = [];   // 进行中的页面内部动画

/** 注册动态；页面被更新的页面盖过后自动冻结（性能保护） */
function registerDynamic(page, tick) {
  activeDynamics.push({ page: page, tick: tick });
  if (activeDynamics.length > 3) activeDynamics.shift();
}

/** 每帧调用（tick 返回 false 表示该动态结束） */
function updateDynamics(now) {
  for (var i = activeDynamics.length - 1; i >= 0; i--) {
    if (activeDynamics[i].tick(now) === false) activeDynamics.splice(i, 1);
  }
}

/** 重绘页面内容层（painter + 纹理更新） */
function repaintPage(page) {
  var p = page.userData.paint;
  if (!p || !p.texture) return;
  p.ctx.clearRect(0, 0, p.W, p.H);
  p.ctx.strokeStyle = p.border || (p.type === 'emergency' ? '#9a5555' : '#3a3f48');
  p.ctx.lineWidth = p.type === 'emergency' ? 4 : 3;
  roundRect(p.ctx, 6, 6, p.W - 12, p.H - 12, 24);
  p.ctx.stroke();
  (PAGE_PAINTERS[p.type] || PAGE_PAINTERS.initial)(p.ctx, p.W, p.H, p.data);
  if (LAST_CLOSE_BTN) { p.closeBtn = LAST_CLOSE_BTN; LAST_CLOSE_BTN = null; }
  p.texture.needsUpdate = true;
}

function fmtCountdown(sec) {
  var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}

/* --- 各动态生成器 --- */

/** 商品主图轮播（每 2.6s 切换一次占位图样式） */
function makeCarousel(page, data) {
  var last = 0, idx = data.variant || 0;
  return function (now) {
    if (now - last < 2600) return true;
    last = now;
    idx++;
    data.variant = idx;
    repaintPage(page);
    return true;
  };
}

/** 活动倒计时（每秒 -1） */
function makeCountdown(page, data) {
  var last = 0;
  return function (now) {
    if (now - last < 1000) return true;
    last = now;
    data.seconds = Math.max(0, data.seconds - 1);
    data.countdown = fmtCountdown(data.seconds);
    repaintPage(page);
    return true;
  };
}

/** 下载进度（~5s 走满，完成后按钮变「打开」并停止） */
function makeDownloadProgress(page, data) {
  var last = 0;
  return function (now) {
    if (now - last < 160) return true;
    last = now;
    data.progress = Math.min(1, (data.progress || 0) + 0.03);
    repaintPage(page);
    return data.progress < 1;
  };
}

/** 跳转页加载（进度爬到 87% 后卡住，加载圈永远转 —— 主题的一部分） */
function makeRedirectAnim(page, data) {
  var last = 0;
  return function (now) {
    if (now - last < 140) return true;
    last = now;
    data.spin = (data.spin || 0) + 0.5;
    data.progress = Math.min(0.87, (data.progress || 0) + 0.022);
    repaintPage(page);
    return true;
  };
}

/** 弹窗出现动画（600ms 淡入 + 轻微放大，一次性） */
function makePopupAppear(page, data) {
  var start = null;
  return function (now) {
    if (start === null) start = now;
    var t = (now - start) / 600;
    data.appear = Math.min(1, t);
    repaintPage(page);
    return t < 1;
  };
}

/** 视频播放进度（~9s 循环 + "跳过广告"5 秒倒计时） */
function makeVideoProgress(page, data) {
  var last = 0;
  return function (now) {
    if (now - last < 200) return true;
    last = now;
    data.progress = (data.progress || 0) + 0.023;
    if (data.progress >= 1) data.progress = 0;          // 循环播放
    data.t = (data.t || 0) + 0.2;
    data.skip = Math.max(0, 5 - Math.floor(data.t));
    repaintPage(page);
    return true;
  };
}

/** 试玩广告（接住金币）：状态机 ready → playing → reward
    ready   ：3.5 秒没人点也会自动开始（广告就是这样）
    playing ：金币下落，篮筐跟随鼠标，接住 +10，8 秒后结束
    reward  ：显示"获得奖励 +50"和"立即下载"按钮（点击进入下一层） */
function makePlayable(page, data) {
  var lastFrame = 0, lastPaint = 0, lastSpawn = 0, readySince = null;
  return function (now) {
    if (data.state === 'done') return false;            // 已下载，定格
    if (data.state === 'ready') {
      if (readySince === null) readySince = now;
      if (now - readySince > 3500) data.state = 'playing';
    }
    if (data.state === 'playing') {
      var dt = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      data.playT = (data.playT || 0) + dt;
      if (now - lastSpawn > 650) {                      // 生成金币
        lastSpawn = now;
        data.coins.push({ x: 70 + Math.random() * 372, y: 84, vy: 200 + Math.random() * 140, spin: Math.random() * 6 });
      }
      var f = data.field || { y: 96, h: 368 };
      var catchY = f.y + f.h - 40;                      // 篮筐高度（painter 同步记录）
      for (var i = data.coins.length - 1; i >= 0; i--) {
        var c = data.coins[i];
        c.y += c.vy * dt;
        c.spin += dt * 6;
        if (c.y > catchY - 26 && c.y < catchY + 26 && Math.abs(c.x - data.basketX) < 62) {
          data.score += 10;                             // 接住！
          data.coins.splice(i, 1);
        } else if (c.y > f.y + f.h) {
          data.coins.splice(i, 1);                      // 漏接
        }
      }
      if (data.playT > 8) { data.state = 'reward'; data.coins = []; }
    }
    if (now - lastPaint < (data.state === 'playing' ? 33 : 160)) return true;
    lastPaint = now;
    repaintPage(page);
    return true;
  };
}

/** 优惠券生命周期：过期倒计时 + 按钮状态（领取 → 已领取 → 去使用） */
function makeCouponLife(page, data) {
  var last = 0;
  return function (now) {
    if (now - last < 1000) return true;
    last = now;
    data.seconds = Math.max(0, (data.seconds || 0) - 1);
    data.countdown = fmtCountdown(data.seconds);
    if (data.state === 0 && data.seconds < data.total - 2) data.state = 1;   // 2 秒后"已领取"
    if (data.state === 1 && data.seconds < data.total - 5) data.state = 2;   // 5 秒后"去使用"
    repaintPage(page);
    return true;
  };
}

/** 实时下单人数（外卖页：数字持续上涨的"紧迫感"） */
function makeBuyersCount(page, data) {
  var last = 0;
  return function (now) {
    if (now - last < 1100) return true;
    last = now;
    data.buyers += 1 + Math.floor(Math.random() * 3);
    repaintPage(page);
    return true;
  };
}

/** 剩余库存（旅游页：缓慢递减到 1，制造稀缺） */
function makeStockCount(page, data) {
  var last = 0;
  return function (now) {
    if (now - last < 2600) return true;
    last = now;
    if (data.stock > 1) {
      data.stock--;
      repaintPage(page);
    }
    return true;
  };
}

/** 原生信息流滚动（列表内容缓慢轮换，像"一直在加载更多"） */
function makeFeedScroll(page, data) {
  var last = 0;
  return function (now) {
    if (now - last < 2800) return true;
    last = now;
    data.offset = (data.offset || 0) + 1;
    repaintPage(page);
    return true;
  };
}

/** 插页"跳过"倒计时（5→0，真实插页的跳过按钮样式） */
function makeSkipCountdown(page, data) {
  var last = 0;
  return function (now) {
    if (now - last < 1000) return true;
    last = now;
    if (data.skip > 0) {
      data.skip--;
      repaintPage(page);
    }
    return true;
  };
}

/** 中奖弹窗特效：光芒旋转 + 纸屑下落 + 标题脉冲 + 按钮光泽 + 倒计时 + 名单轮换 */
function makeYouWonFx(page, data) {
  var last = 0, lastSec = 0, lastTick = 0;
  return function (now) {
    if (now - last < 90) return true;                 // ~11fps 足够（纸屑/光芒不卡）
    var dt = Math.min(0.12, (now - last) / 1000);
    last = now;
    data.t += dt;
    data.rays = (data.rays + dt * 0.55) % (Math.PI / 6);
    data.sweep = (data.sweep + dt * 0.9) % 1.7;
    data.pulse = (Math.sin(data.t * 5.2) + 1) / 2;
    for (var i = 0; i < data.confetti.length; i++) {
      var c = data.confetti[i];
      c.y += c.v * dt;
      c.rot += c.vr * dt;
      if (c.y > 790) { c.y = -14; c.x = 24 + Math.random() * 464; }
    }
    if (now - lastSec > 1000) {
      lastSec = now;
      if (data.seconds > 0) {
        data.seconds--;
        data.countdown = fmtCountdown(data.seconds);
      }
    }
    if (now - lastTick > 2600) {
      lastTick = now;
      data.tickerIdx = (data.tickerIdx + 1) % 5;
    }
    repaintPage(page);
    return true;
  };
}

/** 真实素材图片广告：专用等待队列（不受动态 3 条上限影响），
    素材加载完成（成功或失败）的那一帧重绘一次后出队 */
var imgAdWaiters = [];
function waitForAdImage(page, src) {
  imgAdWaiters.push({ page: page, src: src });
}
function updateImgAdWaiters() {
  for (var i = imgAdWaiters.length - 1; i >= 0; i--) {
    var w = imgAdWaiters[i];
    var rec = loadAdImage(w.src);
    if (rec.status !== 'loading') {
      repaintPage(w.page);
      imgAdWaiters.splice(i, 1);
    }
  }
}

/** 金币雨红包：光芒旋转 + 金币下落 + 标题脉冲 + 按钮光泽 + 过期倒计时 */
function makeGoldRainFx(page, data) {
  var last = 0, lastSec = 0;
  return function (now) {
    if (now - last < 80) return true;
    var dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    data.t = (data.t || 0) + dt;
    data.rays = (data.rays + dt * 0.55) % (Math.PI / 6);
    data.sweep = (data.sweep + dt * 0.9) % 1.7;
    data.pulse = (Math.sin(data.t * 5.2) + 1) / 2;
    for (var i = 0; i < data.coins.length; i++) {
      var k = data.coins[i];
      k.y += k.v * dt;
      k.rot += k.vr * dt;
      if (k.y > 700) { k.y = -16; k.x = 40 + Math.random() * 432; }
    }
    if (now - lastSec > 1000) {
      lastSec = now;
      if (data.seconds > 0) {
        data.seconds--;
        data.countdown = fmtCountdown(data.seconds);
      }
    }
    repaintPage(page);
    return true;
  };
}

/** 幸运转盘：spinning 时加速旋转并减速停下 → result 计算奖品；
    其余时间缓慢空转（待抽奖状态） */
function makeSpinFx(page, data) {
  var last = 0;
  return function (now) {
    if (now - last < 60) return true;
    var dt = Math.min(0.08, (now - last) / 1000);
    last = now;
    data.t = (data.t || 0) + dt;
    data.rays = (data.rays || 0) + dt;
    if (data.state === 'spinning') {
      data.angle += data.speed * dt;
      data.speed = Math.max(0, data.speed - dt * 2.2);
      if (data.speed <= 0.05) {                          // 停下 → 按指针角度算奖品
        data.state = 'result';
        var seg = Math.PI * 2 / data.prizes.length;
        var a = ((-data.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        data.prize = data.prizes[Math.floor(a / seg) % data.prizes.length];
      }
    } else if (data.state === 'ready') {
      data.angle += 0.35 * dt;                           // 待抽奖：缓慢空转
    } else {
      data.angle += 0.15 * dt;                           // 结果：更慢地转
    }
    repaintPage(page);
    return true;
  };
}

/* ============================================================
   2.7 广告页面模板工厂（每种类型独立函数，便于后续调整）
   ============================================================ */

/** 1. 商品促销页（电商红橙 · 大图主导 · 大尺寸） */
function createProductAd(index) {
  var d = PRODUCTS[index % PRODUCTS.length];
  var data = { name: d.name, desc: d.desc, price: d.price, was: d.was, variant: index % 4 };
  var page = createAdPage({ type: 'product', data: data, th: THEMES.shop, size: SIZES.large, canvasW: SIZES.large.cw, canvasH: SIZES.large.ch });
  registerDynamic(page, makeCarousel(page, data));
  return page;
}

/** 2. 活动弹窗页（电商红橙 · 斜光带主视觉 · 大尺寸） */
function createPromotionAd(index) {
  var d = PROMOTIONS[index % PROMOTIONS.length];
  var data = { title: d.title, sub: d.sub, tags: d.tags, seconds: d.hours * 3600 - 137 };
  data.countdown = fmtCountdown(data.seconds);
  var page = createAdPage({ type: 'promotion', data: data, th: THEMES.shop, size: SIZES.large, canvasW: SIZES.large.cw, canvasH: SIZES.large.ch });
  registerDynamic(page, makeCountdown(page, data));
  return page;
}

/** 3. 视频推荐页（视频紫红 · 信息流瀑布 · 大尺寸 · 静态） */
function createRecommendationAd(index) {
  var items = [];
  for (var i = 0; i < 3; i++) items.push(FEEDS[(index * 3 + i) % FEEDS.length]);
  return createAdPage({
    type: 'recommendation',
    data: { items: items, seed: index },
    th: THEMES.video, size: SIZES.large, canvasW: SIZES.large.cw, canvasH: SIZES.large.ch
  });
}

/** 4. 应用安装广告（白卡 · Google App Install 风格：图标+星级+双截图+安装进度按钮） */
function createDownloadAd(index) {
  var d = APPS[index % APPS.length];
  var t = d.t;
  /* 白卡版主题：亮底 + 应用自己的主色（图标/按钮/截图头部） */
  var lite = {
    bg: '#f8f9fb', bg2: '#eceef3', border: 'rgba(120,130,145,0.3)', edge: 0xb8c0cc,
    accent: t.accent, accent2: t.accent2, price: '#ff4d3a', gold: '#ffb800',
    btnFill: t.btnFill, btnStroke: t.btnStroke, text: '#1b1f26', sub: '#6b7480',
    photo: ['#e6ebf2', '#c9d3e0']
  };
  var data = { name: d.name, desc: d.desc, stars: d.stars, dl: d.dl, glyph: d.glyph, th: lite, progress: 0 };
  var page = createAdPage({ type: 'download', data: data, th: lite, size: SIZES.appinstall, canvasW: SIZES.appinstall.cw, canvasH: SIZES.appinstall.ch });
  registerDynamic(page, makeDownloadProgress(page, data));
  return page;
}

/** 5. 跳转中间页（系统灰 · 小型加载窗 · 悬浮在前页上方） */
function createRedirectPage(index) {
  var data = {
    url: 'jump.partner-' + (index % 9 + 1) + '.cn',
    spin: 0, progress: 0
  };
  var page = createAdPage({ type: 'redirect', data: data, th: THEMES.system, size: SIZES.loader, canvasW: SIZES.loader.cw, canvasH: SIZES.loader.ch });
  registerDynamic(page, makeRedirectAnim(page, data));
  return page;
}

/** 6. 连续弹窗页（电商红橙 · 中型悬浮窗 · 悬浮在前页上方） */
function createPopupAd(index) {
  var d = PRODUCTS[(index + 2) % PRODUCTS.length];
  var data = {
    title: d.name + ' 限时特惠',
    sub: '仅剩 ' + (index % 7 + 2) + ' 小时 · 低至 ' + Math.round(d.price / 10) + ' 元',
    variant: index % 4,
    code: index % 90 + 10,
    appear: 0
  };
  var page = createAdPage({ type: 'popup', data: data, th: THEMES.shop, size: SIZES.medium, canvasW: SIZES.medium.cw, canvasH: SIZES.medium.ch });
  registerDynamic(page, makePopupAppear(page, data));
  return page;
}

/** 7. 大字促销页（电商红橙 · 巨号黄字折扣 · 大尺寸） */
function createBigSaleAd(index) {
  var d = BIGSALES[index % BIGSALES.length];
  var data = { num: d.num, unit: d.unit, title: d.title, sub: d.sub, seconds: d.hours * 3600 - 47 };
  data.countdown = fmtCountdown(data.seconds);
  var page = createAdPage({ type: 'bigsale', data: data, th: THEMES.shop, size: SIZES.large, canvasW: SIZES.large.cw, canvasH: SIZES.large.ch });
  registerDynamic(page, makeCountdown(page, data));
  return page;
}

/** 8. 横向通知条（系统样式 + 彩色图标 · 横长比例） */
function createNotificationAd(index) {
  var d = NOTICES[index % NOTICES.length];
  return createAdPage({
    type: 'notification', data: d, th: THEMES.system,
    size: SIZES.notice, canvasW: SIZES.notice.cw, canvasH: SIZES.notice.ch
  });
}

/** 9. 横幅广告（白底 · Mobile Banner：左图 + 文案价格 + 右端 CTA，极扁比例） */
function createBannerAd(index) {
  var d = LIFE_ADS[(index + 1) % LIFE_ADS.length];
  return createAdPage({
    type: 'banner',
    data: { title: d.title, sub: d.sub, tags: d.tags, amount: d.amount, variant: index % 3 },
    th: THEMES.bright, size: SIZES.banner, canvasW: SIZES.banner.cw, canvasH: SIZES.banner.ch
  });
}

/** 10. 系统确认弹窗（克制深灰 · 小型窗 · "即将离开"确认） */
function createSysDialogAd(index) {
  var data = { url: 'jump.partner-' + (index % 9 + 1) + '.cn/confirm' };
  return createAdPage({
    type: 'sysdialog', data: data, th: THEMES.system,
    size: SIZES.small, canvasW: SIZES.small.cw, canvasH: SIZES.small.ch
  });
}

/** 11. 游戏推广页（紫蓝 + 金币 · 角色场景主视觉 · 大尺寸） */
function createGameAd(index) {
  var d = GAMES[index % GAMES.length];
  return createAdPage({
    type: 'game',
    data: { title: d.title, sub: d.sub, reward: d.reward, dl: d.dl, stars: d.stars, variant: index % 3 },
    th: THEMES.game, size: SIZES.large, canvasW: SIZES.large.cw, canvasH: SIZES.large.ch
  });
}

/** 12. 生活服务页（青绿 · 场景图 + 橙色优惠 · 大尺寸） */
function createLifeAd(index) {
  var d = LIFE_ADS[index % LIFE_ADS.length];
  return createAdPage({
    type: 'life',
    data: { title: d.title, sub: d.sub, tags: d.tags, amount: d.amount, seed: index },
    th: THEMES.life, size: SIZES.large, canvasW: SIZES.large.cw, canvasH: SIZES.large.ch
  });
}

/** 13. 美妆时尚页（玫瑰粉 · 大图留白 · 居中排版 · 大尺寸） */
function createBeautyAd(index) {
  var d = BEAUTY[index % BEAUTY.length];
  return createAdPage({
    type: 'beauty',
    data: { name: d.name, desc: d.desc, price: d.price, was: d.was, tag: d.tag, variant: index % 3 },
    th: THEMES.beauty, size: SIZES.large, canvasW: SIZES.large.cw, canvasH: SIZES.large.ch
  });
}

/** 14. 视频广告页（紫红 · 全出血封面 + 播放进度 + 跳过倒计时） */
function createVideoAd(index) {
  var d = FEEDS[index % FEEDS.length];
  var data = { title: d.title, sub: d.sub, progress: 0, t: 0, skip: 5, variant: index % 3 };
  var page = createAdPage({ type: 'video', data: data, th: THEMES.video, size: SIZES.large, canvasW: SIZES.large.cw, canvasH: SIZES.large.ch });
  registerDynamic(page, makeVideoProgress(page, data));
  return page;
}

/** 15. 试玩广告页（Playable · 接住金币 · 可交互：点击开始/鼠标接币/领奖励下载）
    —— 观众短暂"进入广告内部"，最后仍被引向下一层 */
function createPlayableAd(index) {
  var data = { state: 'ready', coins: [], score: 0, basketX: 256, playT: 0, variant: index % 3 };
  var page = createAdPage({ type: 'playable', data: data, th: THEMES.game, size: SIZES.large, canvasW: SIZES.large.cw, canvasH: SIZES.large.ch });
  /* 鼠标悬停 → 篮筐跟随（限制在游戏区内） */
  page.userData.onPageMove = function (px, py) {
    var f = data.field;
    if (f && data.state === 'playing' && px >= f.x && px <= f.x + f.w) {
      data.basketX = clamp(px, f.x + 50, f.x + f.w - 50);
    }
  };
  /* 点击 → 开始试玩 / 领取奖励后"立即下载"（进入下一层） */
  page.userData.onPageClick = function (px, py) {
    if (data.state === 'ready') {
      data.state = 'playing';
      repaintPage(page);
      return true;
    }
    if (data.state === 'reward' && data.dlBtn &&
        px >= data.dlBtn.x && px <= data.dlBtn.x + data.dlBtn.w &&
        py >= data.dlBtn.y && py <= data.dlBtn.y + data.dlBtn.h) {
      data.state = 'done';
      triggerJump();                 // 点"立即下载" → 进入下一层广告
      return true;
    }
    return data.state === 'playing'; // 试玩中的点击不触发全局跳转
  };
  registerDynamic(page, makePlayable(page, data));
  return page;
}

/** 16. 优惠券弹窗（白底票券 · Carrefour 风格：红头带+大金额+打孔虚线+条码+倒计时） */
function createCouponPopup(index) {
  var data = {
    amount: [15, 25, 40][index % 3],
    min: [99, 199, 299][index % 3],
    code: 'NEW' + (index % 90 + 10),
    seconds: 3 * 3600 + 271, total: 3 * 3600 + 271, state: 0,
    appear: 0
  };
  data.countdown = fmtCountdown(data.seconds);
  var page = createAdPage({ type: 'coupon', data: data, th: THEMES.couponw, size: SIZES.coupon, canvasW: SIZES.coupon.cw, canvasH: SIZES.coupon.ch });
  registerDynamic(page, makePopupAppear(page, data));
  registerDynamic(page, makeCouponLife(page, data));
  return page;
}

/** 17. 原生信息流（浅灰 feed + 白卡 · 赞助大卡混在内容之间） */
function createNativeAd(index) {
  var items = [];
  for (var i = 0; i < 3; i++) items.push(NATIVE_FEEDS[(index + i) % NATIVE_FEEDS.length]);
  var data = {
    items: items, offset: 0, seed: index,
    head: ['今日热门', '猜你喜欢', '附近推荐'][index % 3]
  };
  var page = createAdPage({ type: 'native', data: data, th: THEMES.bright, size: SIZES.nativefeed, canvasW: SIZES.nativefeed.cw, canvasH: SIZES.nativefeed.ch });
  registerDynamic(page, makeFeedScroll(page, data));
  return page;
}

/** 20. 全屏插页（Interstitial · 手机竖屏比例：全出血主视觉 + 跳过倒计时 + 折扣爆炸星） */
function createInterstitialAd(index) {
  var d = PRODUCTS[index % PRODUCTS.length];
  var data = {
    brand: '云购商城',
    name: d.name, desc: d.desc, price: d.price, was: d.was,
    off: Math.max(1, Math.round((1 - d.price / d.was) * 10)),
    skip: 5, variant: index % 4, seed: index
  };
  var page = createAdPage({ type: 'interstitial', data: data, th: THEMES.shop, size: SIZES.interstitial, canvasW: SIZES.interstitial.cw, canvasH: SIZES.interstitial.ch });
  registerDynamic(page, makeSkipCountdown(page, data));
  return page;
}

/** 26. 多领域"恭喜中奖"动态广告（版式同 youwon · 每领域独立色系 · 复用同一套动效） */
function createPrizeAd(index, domain) {
  var cfg = PRIZE_DOMAINS[domain != null ? domain : index % PRIZE_DOMAINS.length];
  var pal = cfg.pal;
  var confetti = [];
  for (var i = 0; i < 24; i++) {
    confetti.push({
      x: 24 + seededRand(index * 7 + i) * 464,
      y: seededRand(index * 13 + i) * 780,
      v: 55 + seededRand(i * 3 + 1) * 85,
      rot: seededRand(i + 2) * 6.28,
      vr: (seededRand(i + 5) - 0.5) * 7,
      c: pal.confetti[i % pal.confetti.length]
    });
  }
  var data = {
    t: 0, rays: 0, pulse: 0, sweep: 0,
    confetti: confetti,
    cfg: cfg,
    seconds: 299, countdown: '04:59',
    tickerIdx: 0,
    visitors: '4,128,6' + (10 + index % 80),
    winners: ['138****5678', '159****2381', '186****9024', '133****7742', '175****3068']
  };
  /* 3D 背板/边框/描边也跟随领域色系（createPage 只用 bg/bg2/border/edge） */
  var th = {
    bg: pal.bgIn, bg2: pal.bgOut, border: pal.ray,
    edge: parseInt(pal.accent.slice(1), 16)
  };
  var page = createAdPage({ type: 'prize', data: data, th: th, size: SIZES.youwon, canvasW: SIZES.youwon.cw, canvasH: SIZES.youwon.ch });
  registerDynamic(page, makeYouWonFx(page, data));   // 与 youwon 同一套动效：光芒+纸屑+脉冲+倒计时+名单
  return page;
}

/** 21. 中奖弹窗（YOU WON · 全系统最夸张的诱导广告：光芒+纸屑+礼盒+倒计时+名单轮换） */
function createYouWonAd(index) {
  var confetti = [];
  for (var i = 0; i < 26; i++) {
    confetti.push({
      x: 24 + seededRand(index * 7 + i) * 464,
      y: seededRand(index * 13 + i) * 780,
      v: 55 + seededRand(i * 3 + 1) * 85,
      rot: seededRand(i + 2) * 6.28,
      vr: (seededRand(i + 5) - 0.5) * 7,
      c: ['#ffd23a', '#ff3d8a', '#3ddc97', '#4aa8ff', '#ff9d1c'][i % 5]
    });
  }
  var data = {
    t: 0, rays: 0, pulse: 0, sweep: 0,
    confetti: confetti,
    seconds: 299, countdown: '04:59',
    tickerIdx: 0,
    visitors: '8,675,3' + (10 + index % 80),
    winners: ['138****5678', '159****2381', '186****9024', '133****7742', '175****3068']
  };
  var page = createAdPage({ type: 'youwon', data: data, th: THEMES.youwon, size: SIZES.youwon, canvasW: SIZES.youwon.cw, canvasH: SIZES.youwon.ch });
  registerDynamic(page, makeYouWonFx(page, data));
  return page;
}

/** 22. 真实素材弹窗广告（popup 类素材 · 中型悬浮窗，压在前页上方）
    src 可显式指定（固定序列逐张播放）；缺省按序号取（不再使用） */
function createImagePopupAd(index, src) {
  var s = src || AD_ASSETS.popup[index % AD_ASSETS.popup.length];
  var data = { src: s, seed: index };
  var page = createAdPage({ type: 'imgad', data: data, th: THEMES.system, size: SIZES.medium, canvasW: SIZES.medium.cw, canvasH: SIZES.medium.ch });
  waitForAdImage(page, s);
  return page;
}

/** 23. 真实素材全屏广告（fullPage 类素材 · 手机竖屏比例全屏插页） */
function createImageFullAd(index, src) {
  var s = src || AD_ASSETS.fullPage[index % AD_ASSETS.fullPage.length];
  var data = { src: s, seed: index };
  var page = createAdPage({ type: 'imgad', data: data, th: THEMES.system, size: SIZES.interstitial, canvasW: SIZES.interstitial.cw, canvasH: SIZES.interstitial.ch });
  waitForAdImage(page, s);
  return page;
}

/** 24. 金币雨红包弹窗（紫金 · 仿素材弹窗 · 朝 jackpot 视觉靠拢） */
function createGoldPopAd(index) {
  var coins = [];
  for (var i = 0; i < 14; i++) {
    coins.push({
      x: 40 + seededRand(index * 11 + i) * 432,
      y: seededRand(i * 7 + 2) * 660,
      v: 60 + seededRand(i * 3 + 1) * 85,
      rot: seededRand(i + 2) * 6.28,
      vr: (seededRand(i + 5) - 0.5) * 7
    });
  }
  var data = { t: 0, rays: 0, pulse: 0, sweep: 0, coins: coins, amount: [66, 168, 888][index % 3], seconds: 59, countdown: '00:59' };
  var page = createAdPage({ type: 'goldpop', data: data, th: THEMES.youwon, size: SIZES.medium, canvasW: SIZES.medium.cw, canvasH: SIZES.medium.ch });
  registerDynamic(page, makeGoldRainFx(page, data));
  return page;
}

/** 25. 幸运大转盘（紫金 · 可交互：点击抽奖 → 转盘减速 → 领取奖励进下一层） */
function createSpinAd(index) {
  var data = {
    t: 0, rays: 0, angle: 0, speed: 0, state: 'ready', prize: null, drawBtn: null,
    prizes: ['888 金币', '谢谢参与', '5 元红包', '再来一次', '立减券', '666 金币', '话费券', '谢谢参与']
  };
  var page = createAdPage({ type: 'spin', data: data, th: THEMES.youwon, size: SIZES.medium, canvasW: SIZES.medium.cw, canvasH: SIZES.medium.ch });
  page.userData.onPageClick = function (px, py) {
    var b = data.drawBtn;
    if (!b || px < b.x || px > b.x + b.w || py < b.y || py > b.y + b.h) return false;
    if (data.state === 'ready') {                 // 立即抽奖 → 高速旋转
      data.state = 'spinning';
      data.speed = 7 + Math.random() * 5;
      return true;
    }
    if (data.state === 'result') {                // 领取奖励 → 进入下一层广告
      triggerJump();
      return true;
    }
    return data.state === 'spinning';             // 转动中点击不触发全局跳转
  };
  registerDynamic(page, makeSpinFx(page, data));
  return page;
}

/** 18. 外卖页（红橙 · 食物大图 + 配送信息 + 实时下单人数） */
function createFoodAd(index) {
  var d = FOODS[index % FOODS.length];
  var data = {
    shop: d.shop, name: d.name, rating: d.rating, sales: d.sales,
    price: d.price, was: d.was, eta: d.eta, tags: d.tags,
    buyers: 1200 + (index * 37) % 400, variant: index % 3
  };
  var page = createAdPage({ type: 'food', data: data, th: THEMES.shop, size: SIZES.large, canvasW: SIZES.large.cw, canvasH: SIZES.large.ch });
  registerDynamic(page, makeBuyersCount(page, data));
  return page;
}

/** 19. 旅游页（湖蓝 · 目的地大图 + 价格 + 库存递减/限时倒计时） */
function createTravelAd(index) {
  var d = TRAVELS[index % TRAVELS.length];
  var data = { dest: d.dest, name: d.name, price: d.price, was: d.was, stock: d.stock, seed: index, seconds: d.hours * 3600 - 89 };
  data.countdown = fmtCountdown(data.seconds);
  var page = createAdPage({ type: 'travel', data: data, th: THEMES.travel, size: SIZES.large, canvasW: SIZES.large.cw, canvasH: SIZES.large.ch });
  registerDynamic(page, makeCountdown(page, data));
  registerDynamic(page, makeStockCount(page, data));
  return page;
}

/** 广告类页面（通用入口，type 决定布局） */
function createAdPage(opts) {
  opts.theme = 'ad';
  return createPage(opts);
}

/** 紧急呼救页（空间深处，尺寸与可读性独立控制） */
function createEmergencyPage(opts) {
  opts.theme = 'emergency';
  return createPage(opts);
}

/* ============================================================
   3. 逐次跳转机制（本阶段核心）
   ============================================================ */

/**
 * 只创建一个新页面，加入 pages 列表。
 * 每次调用的返回值就是刚生成的那个页面。
 */
/**
 * 按跳转次数选择广告事件类型（递进，不是纯随机）：
 *   1~2 次：正常商品 / App / 内容推荐 —— 干净可信
 *   3~5 次：促销、弹窗、Banner、下载 —— 商业味变浓
 *   6~8 次：视频、试玩、优惠券、外卖、旅游、游戏 —— 形态多样
 *   9 次+ ：全形态混出 + 打断与误触开始出现（见 runAdEvent）
 * 同一类型不会连续出现两次。
 */
function pickNextType(n) {
  /* 80% 的广告事件使用真实素材图片：
     前期以全屏素材为主（可信度高），中后期 70% 弹窗素材 / 30% 全屏素材 */
  if (Math.random() < 0.8) {
    lastType = (n <= 2) ? 'imgfull' : (Math.random() < 0.7 ? 'imgpopup' : 'imgfull');
    return lastType;
  }
  var pool;
  if (n <= 2)      pool = ['imgfull', 'interstitial', 'download', 'native', 'banner'];   // 前两次：可信的新版式（含真实素材全屏页）
  else if (n <= 5) pool = ['imgfull', 'imgpopup', 'goldpop', 'spin', 'interstitial', 'product', 'promotion', 'popup', 'banner', 'download', 'bigsale', 'life', 'notification', 'native'];
  else if (n <= 8) pool = ['imgfull', 'imgpopup', 'goldpop', 'spin', 'interstitial', 'video', 'playable', 'coupon', 'youwon', 'travel', 'food', 'game', 'beauty', 'native', 'product'];
  else             pool = ['imgpopup', 'imgfull', 'goldpop', 'spin', 'youwon', 'popup', 'video', 'coupon', 'notification', 'banner', 'interstitial', 'playable', 'native', 'sysdialog', 'bigsale', 'travel', 'game', 'life', 'beauty', 'download', 'food', 'redirect'];
  var t;
  do {
    t = pool[Math.floor(Math.random() * pool.length)];
  } while (t === lastType && pool.length > 1);
  lastType = t;
  return t;
}

function createNextPage(forceType, extra) {
  var index = pages.length;
  var type = forceType || pickNextType(index);

  var page;
  if (type === 'product')             page = createProductAd(index);
  else if (type === 'promotion')      page = createPromotionAd(index);
  else if (type === 'recommendation') page = createRecommendationAd(index);
  else if (type === 'download')       page = createDownloadAd(index);
  else if (type === 'redirect')       page = createRedirectPage(index);
  else if (type === 'bigsale')        page = createBigSaleAd(index);
  else if (type === 'notification')   page = createNotificationAd(index);
  else if (type === 'banner')         page = createBannerAd(index);
  else if (type === 'sysdialog')      page = createSysDialogAd(index);
  else if (type === 'game')           page = createGameAd(index);
  else if (type === 'life')           page = createLifeAd(index);
  else if (type === 'beauty')         page = createBeautyAd(index);
  else if (type === 'video')          page = createVideoAd(index);
  else if (type === 'playable')       page = createPlayableAd(index);
  else if (type === 'coupon')         page = createCouponPopup(index);
  else if (type === 'native')         page = createNativeAd(index);
  else if (type === 'food')           page = createFoodAd(index);
  else if (type === 'travel')         page = createTravelAd(index);
  else if (type === 'interstitial')   page = createInterstitialAd(index);
  else if (type === 'youwon')         page = createYouWonAd(index);
  else if (type === 'imgpopup')       page = createImagePopupAd(index, extra && extra.src);
  else if (type === 'imgfull')        page = createImageFullAd(index, extra && extra.src);
  else if (type === 'prize')          page = createPrizeAd(index, extra && extra.domain);
  else if (type === 'goldpop')        page = createGoldPopAd(index);
  else if (type === 'spin')           page = createSpinAd(index);
  else                                page = createPopupAd(index);

  /* ---- 最终位姿：生成时一次性算好并锁定，之后永不改变 ---- */

  // 1) Z 轴：沿固定堆叠轴线前进。
  //    拥挤感只通过压缩"这一层"的间距实现（6层后最多压到 65%），
  //    新页面在视觉上逐渐盖住旧页面 —— 不移动任何旧页面。
  var crowd = clamp(
    (index - (CONFIG.crowdStart - 1)) / (CONFIG.crowdFull - CONFIG.crowdStart + 1),
    0, 1
  );
  stackFrontZ += CONFIG.spacing * (1 - CONFIG.crowdSpacingShrink * crowd);

  // 各版式的空间行为：小窗/弹窗向前悬浮（压在前一个大页面上方，形成局部重叠），
  // 横条几乎不错位 —— 页面之间产生视觉关系，但位置仍然生成即锁定
  var prof = TYPE_PROFILE[type] || TYPE_PROFILE.product;
  page.userData.finalZ = stackFrontZ + prof.zBoost;

  // 2) X/Y 轴：每一层都有自己的持续细微错位 —— 生成时确定，永不改变。
  //    方向按 右下→左上→右上→左下 四象限循环交替（有秩序，不排成一条斜线），
  //    幅度由序号驱动的确定性伪随机微调（0.4~1.0 倍，不随帧变化），
  //    范围限制在 ±maxOffsetX / ±maxOffsetY 内，任何层数都不会归零或向外扩散。
  var quad = index % 4;                          // 交替象限：0右下 1左下 2右上 3左上
  var signX = (quad === 0 || quad === 2) ? 1 : -1;
  var signY = (quad === 0 || quad === 1) ? -1 : 1;
  var magX = 0.4 + seededRand(index) * 0.6;      // 确定性幅度 0.4~1.0
  var magY = 0.4 + seededRand(index + 977) * 0.6;
  page.userData.finalX = signX * magX * CONFIG.maxOffsetX * prof.spread;
  page.userData.finalY = 4 + signY * magY * CONFIG.maxOffsetY * prof.spread;

  // 3) 轻微固定朝向偏转（每层独立、确定性、生成后不变）
  page.userData.finalTiltY = (seededRand(index + 123) - 0.5) * 0.12;

  pages.push(page);

  // 渲染顺序：越新的页面越后渲染 → 半透明正确叠加（生成时固定）
  setStackRenderOrder(page, 10 + index);

  // 按新的层次深度刷新透明度：新页面=最前层，旧页面各退深一档
  // （只调透明度，任何页面的位置都不改变）
  applyLayerOpacity(page, 0);
  updateLayerOpacities();

  // 摄像机视角跟随（只是机位后退，不改变任何页面自身位置）
  lookZTarget = stackFrontZ * 0.35;
  stackOffsetTarget = stackFrontZ + CONFIG.spacing * 1.2;

  page.userData.animating = true; // 飞入动画期间由补间接管

  return page;
}

/** 把页面放到它的最终固定位姿（飞入动画结束时调用一次） */
function placeAtFinal(page) {
  page.position.set(page.userData.finalX, page.userData.finalY, page.userData.finalZ);
  page.rotation.set(0, page.userData.finalTiltY, 0);
}

/**
 * 页面飞入动画：从深处沿 Z 轴向前，带轻微旋转，停在目标位置。
 */
function animatePageIntoSpace(page, onDone) {
  var targetZ = page.userData.finalZ;
  var startZ = targetZ - CONFIG.newPageFlyIn;
  var finalTilt = page.userData.finalTiltY;
  var startTilt = finalTilt + 0.3;

  // 从堆叠后方的固定方向飞入：沿 Z 轴直线前进 + 轻微转正
  page.position.set(page.userData.finalX, page.userData.finalY, startZ);
  page.rotation.y = startTilt;

  addTween(CONFIG.animDuration, function (e) {
    page.position.z = startZ + (targetZ - startZ) * e;
    page.rotation.y = startTilt + (finalTilt - startTilt) * e;
    // 飞入时从更透明到基础透明度，强化"被系统推出来"的感觉
    setGroupOpacity(page, 0.15 + 0.85 * e);
  }, function () {
    // 动画结束：锁定最终位姿，此后完全静止
    placeAtFinal(page);
    setGroupOpacity(page, 1);
    page.userData.animating = false;
    if (onDone) onDone();
  });
}

/**
 * 触发一次跳转（含冷却检查）。
 * 点击 / 空格 / 未来的 Arduino 都会走到这里。
 */
function triggerJump() {
  var now = performance.now();
  if (now < cooldownUntil) return;   // 冷却中，忽略（冷却中的点击不算次数）
  /* 渐进冷却：前几次更克制（作品前期应给用户"清除一次后能缓一缓"的感觉） */
  var n = pages.length;
  var cd;
  if      (n === 0) cd = 2500;   // 第 1 次：2.5 秒冷静期
  else if (n === 1) cd = 2000;   // 第 2 次：2.0 秒
  else if (n === 2) cd = 1600;   // 第 3 次：1.6 秒
  else if (n <  9)  cd = 1300;   // 4~9 次：1.3 秒
  else              cd = CONFIG.cooldownLate;  // 9+ 次：恢复配置（拥挤感）
  cooldownUntil = now + cd;
  runAdEvent();
}

/* 拨打 120 —— 真正的最终状态：锁定系统，不再生成任何广告 */
function triggerDial120() {
  shake = 0.5;
  showStatus('正在拨打 120 ……');
  cooldownUntil = performance.now() + 999999;   // 永久锁定
  timebarFrozen = true;                         // 倒计时冻结（作品结束）
  setTimeout(function () {
    showStatus('已接通急救中心');
    setTimeout(hideStatus, 2400);
  }, 1100);
}

/* ============================================================
   4.5 120 距离系统 + 倾斜监听
   ============================================================ */

/** 计算 120 的目标距离：活跃广告越多，120 越远（后退） */
function updateEmergencyDistance() {
  emergencyTargetZ = EMERGENCY_BASE_Z - pages.length * EMERGENCY_RETREAT;
}

/** 每帧平滑逼近目标距离（让 120 缓慢前后移动，不突兀） */
function updateEmergencyMotion() {
  if (!emergencyPage) return;
  emergencyCurrentZ += (emergencyTargetZ - emergencyCurrentZ) * 0.07;
  emergencyPage.position.z = emergencyCurrentZ;
}

/* ---- 真实设备倾斜（移动端；桌面端 e.beta 为 null 自动跳过）---- */
var tiltLastFired = 0;
function setupTilt() {
  if (typeof window === 'undefined' || !window.DeviceOrientationEvent) return;
  var lastBeta = null, lastGamma = null;
  window.addEventListener('deviceorientation', function (e) {
    if (e.beta === null || e.gamma === null) return;   // 桌面端无数据
    if (lastBeta === null) { lastBeta = e.beta; lastGamma = e.gamma; return; }
    var d = Math.sqrt(
      Math.pow(e.beta - lastBeta, 2) + Math.pow(e.gamma - lastGamma, 2)
    );
    var now = performance.now();
    // 一次倾斜只触发一次；1200ms 防抖（handleTiltTrigger 内还有 cooldown 二次兜底）
    if (d > 6 && now - tiltLastFired > 1200) {
      tiltLastFired = now;
      handleTiltTrigger();
    }
    lastBeta = e.beta;
    lastGamma = e.gamma;
  });
}

/** 生成一个页面并飞入（不含冷却检查 —— 供 jackpot 结算等使用）；
    extra = { src } 指定素材图，或 { domain } 指定中奖广告领域 */
function spawnAdPage(type, onDone, extra) {
  var page = createNextPage(type, extra);
  updateEmergencyDistance();   // 新广告出现 → 120 后退一点
  animatePageIntoSpace(page, onDone);
  return page;
}

/** 打断类广告：后期一次触发里连续冒出的小广告类型 */
function pickInterruptType() {
  return ['notification', 'coupon', 'native', 'sysdialog', 'banner'][Math.floor(Math.random() * 5)];
}

/**
 * 一次"广告事件"（新规则）：
 *   · 只发生在点击/空格/倾斜时 —— 一次点击 = 恰好一个广告页面；
 *   · 广告取自固定序列 AD_SEQUENCE（13 张真实素材各一次），点击多少次出现多少个；
 *   · 序列放完 → 不循环：点击只扣时间、提示"没有更多"，不再生成新广告；
 *   · 每次点击扣 1.5~2.2 秒；时间归零的那次点击，它的"广告"就是 jackpot。
 */
function runAdEvent() {
  if (timebarFrozen) return;              // jackpot 已出 / 已拨 120：整体结束
  deductTime();                           // 时间只在点击时减少
  if (jackpotFired) return;               // 这次点击的广告 = jackpot，不再放素材
  var item = nextAdItem();
  if (!item) {
    shake = 0.4;
    showStatus('已到最后 · 没有更多广告了');
    setTimeout(hideStatus, 1100);
    return;
  }
  shake = 1;
  showStatus('正在跳转……');
  spawnAdPage(item.type, function () {
    showStatus('跳转完成 · ' + adSeqPos + ' / ' + AD_SEQUENCE.length);
    setTimeout(hideStatus, 900);
  }, item);
}

/**
 * 误触关闭（叉掉效果已恢复）：点了 ✕ 不会关闭 ——
 * 先弹出"正在打开"加载页（进度永远卡在 87%），随后又出现一个新广告。
 * （作品对现实广告"关闭即跳转"机制的模拟，不是恶搞彩蛋）
 */
function fakeCloseJump() {
  if (timebarFrozen) return;               // 整体已结束：不再有任何反应
  shake = 0.7;
  showStatus('正在打开……');
  cooldownUntil = performance.now() + CONFIG.cooldown;   // 防连点失控
  deductTime();                                          // 关闭也是一次触发：扣时 1.5~2.2 秒
  if (jackpotFired) return;                              // 这次点击的广告 = jackpot
  spawnAdPage('redirect');                               // 1) 跳转加载页（进度永远卡在 87%）
  setTimeout(function () {
    var item = nextAdItem();
    if (item) {
      showStatus('即将进入……');
      spawnAdPage(item.type, null, item);                // 2) "加载完" → 又是广告
    } else {
      showStatus('已到最后 · 没有更多广告了');
    }
    setTimeout(hideStatus, 900);
  }, 1400);
  setTimeout(hideStatus, 1300);
}

/* ============================================================
   ★ Arduino 触发接口（预留，暂不接入硬件）★
   后续串口侧根据传感器动作幅度分发到不同函数即可。
   当前鼠标点击 / 空格仍走 handleTiltTrigger()。
   ============================================================ */
function handleTiltTrigger() {        // 统一入口：常规跳转
  triggerJump();
}
function handleSmallTilt() {          // 轻微倾斜：与常规跳转一致（固定序列，一次一个）
  triggerJump();
}
function handleStrongTilt() {         // 明显倾斜：全屏广告 / 常规跳转
  triggerJump();
}
function handleReturnAttempt() {      // 反向倾斜：尝试返回（被广告拦截 —— 作品主题）
  shake = 0.8;
  showStatus('返回被拦截 · 请继续浏览');
  setTimeout(hideStatus, 900);
}

/* ============================================================
   排布说明：不存在自动重排。
   每个页面的最终位姿在 createNextPage() 生成时一次性锁定，
   之后任何代码都不会再修改它的位置/旋转/缩放/透明度。
   ============================================================ */

/** 确定性伪随机：同一序号永远返回同一 0~1 值（不随帧变化、不受重排影响） */
function seededRand(n) {
  var v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/* ============ 简易补间动画系统 ============ */
function addTween(duration, onUpdate, onDone) {
  animations.push({ start: performance.now(), duration: duration, onUpdate: onUpdate, onDone: onDone });
}

function updateAnimations(now) {
  for (var i = animations.length - 1; i >= 0; i--) {
    var a = animations[i];
    var t = Math.min(1, (now - a.start) / a.duration);
    var e = easeOutCubic(t);
    a.onUpdate(e, t);
    if (t >= 1) {
      animations.splice(i, 1);
      if (a.onDone) a.onDone();
    }
  }
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

/** 按比例调整页面组透明度（飞入动画用），完成后回到各材质的基础透明度 */
function setGroupOpacity(group, factor) {
  group.traverse(function (obj) {
    if (obj.material && obj.userData.baseOpacity !== undefined) {
      var o = obj.userData.baseOpacity * factor;
      obj.material.opacity = o;
      obj.material.transparent = o < 0.999;
    }
  });
}

/* ============ 层次透明度控制 ============ */

/**
 * 按页面在堆叠中的深度设置透明度（depth 0 = 最前层）：
 *   背景层：0.78 起，每深一层 -0.09，下限 0.28 → 后方页面透出来
 *   背板：随背景等比缩放
 *   内容层（文字/按钮/边框）：仅轻微衰减，始终可辨认
 */
function applyLayerOpacity(page, depth) {
  var bgO = clamp(CONFIG.frontOpacity - CONFIG.depthOpacityFall * depth, CONFIG.minOpacity, CONFIG.frontOpacity);
  var textO = Math.max(0.65, CONFIG.contentOpacity - 0.045 * depth);
  setPageMatOpacity(page.userData.bgMesh, bgO);
  setPageMatOpacity(page.userData.backMesh, bgO * 0.55);
  setPageMatOpacity(page.userData.contentMesh, textO);
}

function setPageMatOpacity(mesh, o) {
  if (!mesh) return;
  mesh.userData.baseOpacity = o;   // 同步补间动画用的基准值
  mesh.material.opacity = o;
}

/** 新页面加入后，按各页面新的深度刷新透明度（只调透明度，不改任何位置） */
function updateLayerOpacities() {
  var n = pages.length;
  pages.forEach(function (p, i) {
    if (p.userData.animating) return;  // 飞入中的页面由动画接管
    applyLayerOpacity(p, n - 1 - i);   // i 越小越深，depth 0 = 最前
  });
}

/** 设置页面在半透明堆叠中的渲染顺序（内容层略晚于本页背景层） */
function setStackRenderOrder(page, order) {
  page.children.forEach(function (child) {
    child.renderOrder = order + (child.userData.isContent ? 1 : 0);
  });
}

/* ============ 状态提示（HTML覆盖层） ============ */
var statusEl;

function showStatus(text) {
  statusEl.textContent = text;
  statusEl.classList.add('visible');
}

function hideStatus() {
  statusEl.classList.remove('visible');
}

/* ============================================================
   4.6 顶部倒计时（#timebar）：只在点击时减少 + 归零出 jackpot（终点）
   ------------------------------------------------------------
   · 30 秒不随真实时间流逝 —— 只有点击（跳转/误触关闭）才会扣 1.5~2.2 秒；
   · 归零的那次点击：它的广告就是 jackpot（中奖弹窗），随后整体结束；
   · 结束后时间冻结，不再重置、不再循环、不再生成任何广告；
   · 拨通 120 同样冻结（作品结束，时间失去意义）。
   ============================================================ */
var TIMEBAR_TOTAL = 42;              // 总时长（秒）—— 只能被点击消耗（18 个广告 × 平均 1.85 秒 + 余量）
var timebarRemain = TIMEBAR_TOTAL * 1000;
var timebarFrozen = false;            // jackpot / 拨通 120 后冻结
var jackpotFired = false;
var timebarEl, timebarNumEl, timebarFillEl;

function setupTimebar() {
  timebarEl = document.getElementById('timebar');
  timebarNumEl = document.getElementById('timebar-num');
  timebarFillEl = document.getElementById('timebar-fill');
  renderTimebar();
}

function fmtTimebar(sec) {
  var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}

function renderTimebar() {
  if (!timebarNumEl || !timebarFillEl) return;
  var sec = Math.max(0, timebarRemain / 1000);
  timebarNumEl.textContent = fmtTimebar(sec);
  timebarFillEl.style.width = (clamp(sec / TIMEBAR_TOTAL, 0, 1) * 100) + '%';
  if (timebarEl) timebarEl.classList.toggle('low', sec <= 10);
}

/** 每次点击的代价：随机扣 1.5~2.2 秒（时间只在点击时减少）；
    扣到 0 → jackpot（这次点击的广告就是 jackpot） */
function deductTime() {
  if (timebarFrozen) return;
  timebarRemain = Math.max(0, timebarRemain - (1500 + Math.random() * 700));
  renderTimebar();
  if (timebarRemain <= 0) triggerJackpot();
}

/** 每帧调用（dt 秒）—— 时间不再随真实时间流逝，这里不做任何事 */
function updateTimebar(dt) {
  /* 空实现：倒计时只由 deductTime()（点击）推进 */
}

/** 时间归零：jackpot（中奖）广告弹出并永久保留 —— 这是整体的终点。
    不重置倒计时、不循环：此后任何点击都不再生成广告。 */
function triggerJackpot() {
  if (jackpotFired) return;
  jackpotFired = true;
  timebarFrozen = true;                          // 整体结束：时间停在此刻
  shake = 1;
  cooldownUntil = performance.now() + 999999;    // 永久锁定：不再生成任何广告
  showStatus('JACKPOT · 时间耗尽 · 到此为止');
  spawnAdPage('youwon');
  setTimeout(hideStatus, 2600);
}

/* ============================================================
   4. 交互：拖动旋转 + 滚轮前后 + 点击/空格触发
   ------------------------------------------------------------
   点击会先做"页面拾取"（射线 → 最前方被点到的页面 → 画布坐标）：
     · 点到 ✕ 关闭按钮 → fakeCloseJump()（误触跳转）
     · 页面声明了 onPageClick（试玩广告）→ 广告内部交互
     · 其余点击 → handleTiltTrigger() 常规跳转
   悬停（未拖动时）→ onPageMove（试玩广告的篮筐跟随鼠标）
   ============================================================ */

/* 页面拾取：屏幕坐标 → { page, px, py }（画布像素坐标），未命中返回 null */
var _raycaster = null;
var _pointerNDC = null;
function pickPageAt(clientX, clientY) {
  if (!_raycaster) {
    _raycaster = new THREE.Raycaster();
    _pointerNDC = new THREE.Vector2();
  }
  _pointerNDC.x = (clientX / window.innerWidth) * 2 - 1;
  _pointerNDC.y = -(clientY / window.innerHeight) * 2 + 1;
  _raycaster.setFromCamera(_pointerNDC, camera);
  var meshes = [];
  pages.forEach(function (p) {
    if (p.userData.contentMesh) meshes.push(p.userData.contentMesh);
    if (p.userData.bgMesh) meshes.push(p.userData.bgMesh);
  });
  var hits = _raycaster.intersectObjects(meshes, false);
  if (!hits.length) return null;
  var best = null;                    // 命中的页面里取"最前"的那一个
  for (var i = 0; i < hits.length; i++) {
    var g = hits[i].object.userData.pageGroup;
    if (!g) continue;
    if (!best || g.userData.finalZ > best.g.userData.finalZ) best = { g: g, hit: hits[i] };
  }
  if (!best) return null;
  var p = best.g.userData.paint;
  if (!p || !best.hit.uv) return null;
  return { page: best.g, px: best.hit.uv.x * p.W, py: (1 - best.hit.uv.y) * p.H };
}

function setupInteraction() {
  var dragging = false;
  var lastX = 0, lastY = 0;
  var downX = 0, downY = 0;
  var moved = false;

  function onDown(e) {
    dragging = true;
    moved = false;
    downX = lastX = e.clientX;
    downY = lastY = e.clientY;
  }
  function onMove(e) {
    if (!dragging) {
      // 悬停拾取：试玩广告的"篮筐"跟随鼠标（不做其他事，开销极低）
      var hov = pickPageAt(e.clientX, e.clientY);
      if (hov && hov.page.userData.onPageMove) hov.page.userData.onPageMove(hov.px, hov.py);
      return;
    }
    var dx = e.clientX - lastX;
    var dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 6) moved = true;

    orbit.angleX += dx * 0.004;
    orbit.angleY += dy * 0.003;
    orbit.angleY = Math.max(-0.9, Math.min(0.6, orbit.angleY));
  }
  function onUp() {
    dragging = false;
  }
  function onClick(e) {
    if (moved) return;                // 拖动视角不算点击
    var pick = pickPageAt(e.clientX, e.clientY);
    if (pick) {
      var pt = pick.page.userData.paint;
      /* 0) 点到 120 按钮：进入最终状态（拨打 120） */
      if (pt.dialBtn) {
        var dx = pick.px - pt.dialBtn.x, dy = pick.py - pt.dialBtn.y;
        if (Math.abs(dx) < pt.dialBtn.w / 2 && Math.abs(dy) < pt.dialBtn.h / 2) {
          triggerDial120();
          return;
        }
      }
      /* 1) 点到 ✕ 关闭按钮：本作品没有真正的关闭 —— 关闭即跳转 */
      if (pt.closeBtn) {
        var dx = pick.px - pt.closeBtn.x, dy = pick.py - pt.closeBtn.y;
        var d2 = dx * dx + dy * dy;
        var R = pt.closeBtn.r;                          // 画布像素半径（24）
        if (d2 <= (R * 6) * (R * 6)) {                  // 点 ✕ 及附近 144px：一律误触跳转
          fakeCloseJump();
          return;
        }
      }
      /* 2) 页面自定义点击（试玩广告内部交互），返回 true 表示已消费 */
      if (pick.page.userData.onPageClick && pick.page.userData.onPageClick(pick.px, pick.py)) return;
    } else {
      /* 没点中任何页面：也算一次点击（一次点击 = 恰好一个广告，不会多也不会少） */
      handleTiltTrigger();
      return;
    }
    /* 3) 点中广告但不是关闭按钮/内部交互：常规跳转（"点进广告"=下一层） */
    handleTiltTrigger();
  }

  function onWheel(e) {
    e.preventDefault();
    orbit.distance += e.deltaY * 0.05;
    orbit.distance = Math.max(15, Math.min(220, orbit.distance));
  }

  function onKeyDown(e) {
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      handleTiltTrigger();
    }
  }

  var el = renderer.domElement;
  el.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  el.addEventListener('click', onClick);
  el.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);
}

/* 每帧更新摄像机（含晃动效果） */
function updateCamera() {
  var r = orbit.distance;
  var x = Math.sin(orbit.angleX) * Math.cos(orbit.angleY) * r;
  var y = Math.sin(orbit.angleY) * r + orbit.targetY + 4;
  var z = Math.cos(orbit.angleX) * Math.cos(orbit.angleY) * r;

  // 触发时的空间轻微晃动（快速衰减）
  if (shake > 0.001) {
    x += (Math.random() - 0.5) * shake * 1.2;
    y += (Math.random() - 0.5) * shake * 0.8;
    shake *= 0.88;
  }

  // 注视点平滑移动
  lookZCurrent += (lookZTarget - lookZCurrent) * 0.04;

  // 摄像机后退量平滑逼近目标（堆叠向前生长 → 摄像机缓慢退后）
  stackOffsetCurrent += (stackOffsetTarget - stackOffsetCurrent) * 0.03;

  camera.position.set(x, y, z + stackOffsetCurrent);
  camera.lookAt(0, orbit.targetY, lookZCurrent);
}

/* ============================================================
   5. 页面微动态 + 动画循环
   ============================================================ */

function updatePageMicroMotion(t) {
  // 所有页面在飞入动画结束后完全静止：
  // 不自动移动、旋转、缩放、改变透明度，也不因新增页面而重新排布。
  // （用户拖动鼠标改变的是摄像机视角，页面自身位置不变）
}

function animate() {
  requestAnimationFrame(animate);

  var now = performance.now();
  var dt = clock.getDelta();
  var t = clock.elapsedTime;

  updateAnimations(now);
  updateDynamics(now);        // 页面内部动态（倒计时/进度/轮播，深层自动冻结）
  updatePageMicroMotion(t);
  updateImgAdWaiters();       // 真实素材加载完成后重绘对应页面
  updateTimebar(dt);          // 顶部倒计时：只由点击推进（此处空实现，保留钩子）
  updateEmergencyMotion();    // 120 随广告增减前后移动
  updateCamera();

  renderer.render(scene, camera);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

/* ============================================================
   6. 启动
   ============================================================ */

function init() {
  statusEl = document.getElementById('status');
  setupTimebar();              // 顶部剩余时间（30s 一轮，触发扣时，归零出 jackpot）
  preloadAdAssets();           // 预载全部真实素材（生成广告页时图片大概率已就绪）

  /* file:// 协议下，本地图片画入 canvas 会"污染"画布，
     WebGL 纹理上传失败 → 图片广告整页黑屏。检测并给出提示。 */
  if (window.location.protocol === 'file:') {
    var warn = document.createElement('div');
    warn.textContent = '当前以本地文件方式打开：图片广告会显示黑屏。请双击「启动广告.bat」通过本地服务器打开';
    warn.style.cssText = 'position:fixed;bottom:64px;left:50%;transform:translateX(-50%);' +
      'background:rgba(226,58,32,0.92);color:#fff;padding:10px 20px;border-radius:8px;' +
      'font-size:13px;letter-spacing:1px;z-index:99;white-space:nowrap;';
    document.body.appendChild(warn);
  }

  createScene();
  createCamera();
  createLights();
  createRenderer();
  clock = new THREE.Clock();

  // ---- 初始状态：空间里没有任何广告，只有一个"紧急呼救"目标 ----
  // pages 保持为空数组。广告只能在用户"误触 / 倾斜"时动态生成。

  // ---- 紧急呼救：唯一目标。初始就在眼前，随广告增减前后移动（不固定）----
  emergencyPage = createEmergencyPage({
    title: EMERGENCY_PAGE.title,
    content: EMERGENCY_PAGE.content,
    button: EMERGENCY_PAGE.button
  });
  emergencyTargetZ = EMERGENCY_BASE_Z;
  emergencyCurrentZ = EMERGENCY_BASE_Z;
  emergencyPage.position.set(0, 5, emergencyCurrentZ);
  setStackRenderOrder(emergencyPage, 1);

  setupInteraction();
  setupTilt();                 // 真实设备倾斜（移动端）
  window.addEventListener('resize', onResize);

  animate();
}

init();
