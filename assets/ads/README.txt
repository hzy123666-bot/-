此目录用于存放广告素材图片。

《跳转之外》图片素材替换接口（main.js 顶部 PAGE_IMAGES）：

把图片文件放进本目录（assets/ads/），然后在 main.js 中注册：

    PAGE_IMAGES['game_art_0'] = 'assets/ads/game_art_0.jpg';

注册后，对应的程序化占位图会自动替换为真实图片（cover 裁切填满图框），
无需修改任何绘制代码。

可用的 key 规则：<类别>_<序号 0~2>，对应 drawPhoto 的绘制类别：

    product_0 / product_1 / product_2   商品主图（电商红橙页面）
    game_art_0 / game_art_1 / ...       游戏主视觉（紫蓝页面）
    video_cover_0 / video_cover_1 / ... 视频封面（紫红视频广告）
    beauty_shot_0 / beauty_shot_1 / ... 美妆产品图（玫瑰粉页面）
    scene_0 / scene_1 / ...             生活场景图（青绿页面）
    food_0 / food_1 / ...               外卖食物图（红橙外卖页）
    travel_0 / travel_1 / ...           旅游目的地图（湖蓝旅游页）
    ui_0 / ui_1 / ...                   应用截图（下载页）
    abstract_0 / abstract_1 / ...       抽象光带

建议尺寸：600×600 以上，横竖皆可（自动裁切）。
未注册的类别继续使用程序化绘制，不影响运行。
