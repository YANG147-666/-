const express = require('express');
const axios = require('axios');
const path = require('path');
const https = require('https');
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// ================= 配置区 =================
const WX_APP_ID = process.env.WX_APP_ID || 'wxb40647d5af50daff'; 
const WX_APP_SECRET = process.env.WX_APP_SECRET || 'ad64dad676f1bb6a6071fcb269851e1b';
const DOMAIN = process.env.DOMAIN || 'https://shake-game-204673-6-1330326648.sh.run.tcloudbase.com';
const PORT = process.env.PORT || 80;

// 【重要】在这里填入你上传到云开发的视频链接 (必须以 http/https 开头)
// 比如: 'https://7368-shake-game-123456.tcb.qcloud.la/my-background.mp4'
const BG_VIDEO_URL = 'https://6b65-key-manager-cloud-7egqyu8d6c8dc9-1330326648.tcb.qcloud.la/%E8%A7%86%E9%A2%91/bg.mp4?sign=31cf8b2581107ef391725e81e70d5fa1&t=1764764686'; 

const GAME_DURATION = 30; 
const TRACK_MAX_SCORE = 1000; 

// =========================================

let gameState = 'waiting'; 
let players = {}; 
let gameTimer = null;
let countdownTimer = null;
let remainingTime = GAME_DURATION;

function clearAllTimers() {
    if (gameTimer) { clearInterval(gameTimer); gameTimer = null; }
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
}

io.on('connection', (socket) => {
    socket.emit('game_state_change', gameState);

    socket.on('join_game', (userInfo) => {
        if (!players[socket.id]) {
            players[socket.id] = {
                id: socket.id,
                name: userInfo.nickname,
                avatar: userInfo.headimgurl,
                score: 0
            };
            io.emit('update_players', sortPlayers());
            socket.emit('game_state_change', gameState);
        }
    });

    socket.on('admin_start_game', () => {
        if (gameState === 'racing' || gameState === 'countdown') return;
        
        clearAllTimers();
        Object.keys(players).forEach(id => players[id].score = 0);
        io.emit('update_players', sortPlayers());
        
        gameState = 'countdown';
        io.emit('game_state_change', 'countdown');
        
        let prepCount = 3;
        io.emit('countdown_tick', prepCount);
        
        countdownTimer = setInterval(() => {
            prepCount--;
            io.emit('countdown_tick', prepCount);
            if (prepCount <= 0) {
                clearInterval(countdownTimer);
                countdownTimer = null;
                setTimeout(() => { startGameLogic(); }, 500);
            }
        }, 1000);
    });

    socket.on('admin_reset_game', () => {
        clearAllTimers();
        gameState = 'waiting';
        remainingTime = GAME_DURATION;
        Object.keys(players).forEach(id => players[id].score = 0);
        io.emit('update_players', sortPlayers());
        io.emit('game_state_change', 'waiting');
    });

    socket.on('shake', () => {
        if (gameState !== 'racing') return;
        const player = players[socket.id];
        if (player) {
            // 添加双倍得分机制 - 30%几率获得双倍积分
            const isDouble = Math.random() <= 0.3;
            const scoreToAdd = isDouble ? 2 : 1;
            player.score += scoreToAdd;
            
            // 如果是双倍得分，发送特殊弹幕
            if (isDouble) {
                const cheers = ['✨ 双倍得分!', '🌟 幸运之星!', '🎉 超级加倍!', '💎 钻石得分!'];
                io.emit('new_barrage', { 
                    avatar: player.avatar, 
                    text: cheers[Math.floor(Math.random()*cheers.length)] 
                });
            } else if (Math.random() > 0.98) {
                const cheers = ['🏇 驾！', '⚡️ 绝尘而去！', '🔥 冲啊！', '🚀 遥遥领先！'];
                io.emit('new_barrage', { 
                    avatar: player.avatar, 
                    text: cheers[Math.floor(Math.random()*cheers.length)] 
                });
            }
            
            io.emit('update_players', sortPlayers());
        }
    });

    socket.on('disconnect', () => {
        if (players[socket.id]) {
            delete players[socket.id];
            io.emit('update_players', sortPlayers());
        }
    });
});

function startGameLogic() {
    gameState = 'racing';
    io.emit('game_state_change', 'racing');
    remainingTime = GAME_DURATION;
    io.emit('time_update', remainingTime);
    
    clearAllTimers();
    
    gameTimer = setInterval(() => {
        remainingTime--;
        io.emit('time_update', remainingTime);
        if (remainingTime <= 0) {
            clearInterval(gameTimer);
            gameTimer = null;
            gameState = 'finished';
            io.emit('game_over', sortPlayers());
        }
    }, 1000);
}

function sortPlayers() { return Object.values(players).sort((a, b) => b.score - a.score); }

app.get('/MP_verify_qwWEAQM3dPUfFpwd.txt', (req, res) => {
    const filePath = path.join(__dirname, 'MP_verify_qwWEAQM3dPUfFpwd.txt');
    res.sendFile(filePath); 
});

app.get('/mobile', (req, res) => {
    const callbackUrl = encodeURIComponent(`${DOMAIN}/wechat/callback`);
    const url = `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${WX_APP_ID}&redirect_uri=${callbackUrl}&response_type=code&scope=snsapi_userinfo&state=STATE#wechat_redirect`;
    res.redirect(url);
});

app.get('/wechat/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.send('请在微信客户端打开');
    try {
        const ignoreSSL = new https.Agent({ rejectUnauthorized: false });
        const tokenResp = await axios.get(`https://api.weixin.qq.com/sns/oauth2/access_token?appid=${WX_APP_ID}&secret=${WX_APP_SECRET}&code=${code}&grant_type=authorization_code`, { httpsAgent: ignoreSSL });
        if (tokenResp.data.errcode) return res.send('授权失败');
        const { access_token, openid } = tokenResp.data;
        const userResp = await axios.get(`https://api.weixin.qq.com/sns/userinfo?access_token=${access_token}&openid=${openid}&lang=zh_CN`, { httpsAgent: ignoreSSL });
        res.send(renderMobilePage(userResp.data));
    } catch (error) { res.send('登录错误'); }
});

// =================================================================
// 🎨 大屏幕 UI V7.5 (支持云存储视频链接)
// =================================================================
app.get('/', (req, res) => {
    const mobileUrl = `${DOMAIN}/mobile`;
    res.send(`
<!DOCTYPE html>
<html lang="zh">
<head>
    <meta charset="UTF-8">
    <title>龙马精神·年会大奖赛</title>
    <script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js"></script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&family=Exo+2:wght@700&display=swap');
        body { margin: 0; padding: 0; height: 100vh; overflow: hidden; color: white; background: #000; }

        .hidden { display: none !important; }
        .force-hide { display: none !important; }

        /* 视频背景层 */
        #bg-layer {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: -100;
        }
        .video-bg { 
            width: 100%; height: 100%; object-fit: cover; 
        }
        .video-mask { 
            position: absolute; top: 0; left: 0; width: 100%; height: 100%; 
            background: rgba(0, 0, 0, 0.4); 
        }

        /* 倒计时层 */
        #countdown-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.85);
            z-index: 10000; 
            justify-content: center; align-items: center;
            display: none; /* 初始隐藏 */
        }
        #countdown-text {
            font-size: 25rem; font-weight: bold; color: gold;
            text-shadow: 0 0 50px red, 0 0 20px yellow;
            font-family: 'Exo 2', sans-serif;
            animation: popIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        @keyframes popIn { from { transform: scale(0); opacity: 0; } to { transform: scale(1); opacity: 1; } }

        /* 大厅 */
        #view-lobby {
            position: absolute; width: 100%; height: 100%; z-index: 10;
            font-family: 'Microsoft YaHei', sans-serif; display: flex; 
        }
        .header-area { position: absolute; top: 5%; width: 100%; text-align: center; }
        .main-title {
            font-family: 'Ma Shan Zheng', cursive; font-size: 8rem; margin: 0;
            background: linear-gradient(180deg, #fff 0%, #ffd700 30%, #ff8c00 100%);
            -webkit-background-clip: text; color: transparent;
            filter: drop-shadow(0 5px 0 #8b0000) drop-shadow(0 10px 10px rgba(0,0,0,0.5));
            -webkit-text-stroke: 2px rgba(255, 255, 255, 0.8);
            animation: float 3s ease-in-out infinite;
        }
        .sub-title {
            font-size: 2rem; color: #fff; font-weight: bold;
            background: linear-gradient(90deg, transparent, #b30000, transparent);
            padding: 5px 60px; margin-top: 5px; letter-spacing: 5px;
            border-top: 1px solid rgba(255,215,0,0.5); border-bottom: 1px solid rgba(255,215,0,0.5);
        }
        .center-bar { position: absolute; top: 42%; width: 100%; display: flex; justify-content: center; align-items: center; gap: 50px; }
        .btn-start {
            background: linear-gradient(to bottom, #ff4d4d, #b30000); color: white; border: 3px solid #fff;
            padding: 15px 70px; font-size: 2.5rem; border-radius: 60px;
            cursor: pointer; box-shadow: 0 0 30px rgba(255, 0, 0, 0.6); font-weight: bold; transition: transform 0.1s;
        }
        .btn-start:active { transform: scale(0.95); }
        
        #lobby-list {
            position: absolute; bottom: 5%; width: 90%; left: 5%; height: 28%;
            display: flex; justify-content: center; align-items: center; gap: 30px;
            overflow-x: auto; background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(8px);
            border-radius: 20px; border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .slot { display: flex; flex-direction: column; align-items: center; flex-shrink: 0; width: 110px; }
        .slot-circle { width: 90px; height: 90px; border-radius: 50%; background: rgba(0,0,0,0.3); border: 4px solid rgba(255,215,0,0.3); display: flex; justify-content: center; align-items: center; }
        .slot-empty { border: 3px dashed rgba(255, 255, 255, 0.6) !important; background: rgba(255, 255, 255, 0.1) !important; }
        .slot-img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
        
        .slot-name { 
            margin-top: 10px; font-size: 1rem; color: #fff; text-shadow: 1px 1px 2px black; 
            width: 100px; text-align: center;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }

        /* 赛马场 */
        #view-race {
            position: absolute; width: 100%; height: 100%; z-index: 20; display: none;
            background: radial-gradient(circle at center, #1e6b36 0%, #0d3819 100%);
            font-family: 'Microsoft YaHei', sans-serif;
        }
        .timer-panel {
            position: absolute; top: 20px; left: 50%; transform: translateX(-50%);
            background: rgba(0,0,0,0.6); padding: 10px 40px; border-radius: 20px;
            border: 2px solid gold; text-align: center; z-index: 30;
            box-shadow: 0 5px 15px rgba(0,0,0,0.5);
        }
        #timer-num { font-size: 4rem; font-weight: bold; color: gold; line-height: 1; }
        .timer-label { font-size: 1rem; color: #fff; opacity: 0.9; letter-spacing: 2px; }

        .track-area { 
            position: absolute; top: 140px; width: 95%; left: 2.5%; 
            height: 75vh; overflow-y: visible; z-index: 5;
        }
        
        .lane-horse {
            height: 80px; 
            margin-bottom: 10px; 
            position: relative;
            background: rgba(0, 0, 0, 0.2); 
            border-bottom: 2px solid rgba(255,255,255,0.2);
            display: flex; 
            align-items: center;
            overflow: visible;
        }
        
        .start-line { position: absolute; left: 0; top: 0; bottom: 0; width: 5px; background: white; z-index: 1; }
        .finish-line { position: absolute; right: 0; top: 0; bottom: 0; width: 10px; background-image: repeating-linear-gradient(45deg, #000 0, #000 10px, #fff 10px, #fff 20px); z-index: 1; }

        .horse-runner {
            position: absolute; 
            left: 0; 
            top: 50%; 
            transform: translateY(-50%);
            width: 100px; 
            height: 80px;
            transition: left 0.5s linear; /* 从0.3s改为0.8s，让移动更慢 */
            z-index: 500;
        }
        
        .horse-body {
            font-size: 3rem; 
            position: absolute; 
            bottom: 0; 
            left: 0;
            transform: scaleX(-1);
            filter: drop-shadow(5px 5px 5px rgba(0,0,0,0.5));
            animation: gallop 0.6s infinite alternate ease-in-out;
            z-index: 10;
        }
        
        .horse-body.double-score {
            filter: drop-shadow(5px 5px 5px rgba(0,0,0,0.5)) hue-rotate(180deg);
            animation: gallopDouble 0.3s infinite alternate ease-in-out;
            color: gold;
        }
        
        .jockey-avatar {
            position: absolute; 
            top: 5px; 
            left: 15px;
            width: 30px; 
            height: 30px;
            border-radius: 50%; 
            border: 2px solid gold;
            background: white; 
            object-fit: cover;
            animation: bounce 0.6s infinite alternate ease-in-out;
            z-index: 11;
        }
        
        .runner-name {
            position: absolute; 
            top: -20px; 
            left: 50%; 
            transform: translateX(-50%);
            background: rgba(0,0,0,0.6); 
            color: white; 
            padding: 2px 8px;
            border-radius: 10px; 
            font-size: 0.8rem; 
            white-space: nowrap;
            z-index: 12;
        }
        
        .runner-name.double-score {
            background: gold;
            color: black;
            font-weight: bold;
            box-shadow: 0 0 10px gold;
        }
        
        .dust {
            position: absolute; 
            bottom: 5px; 
            left: -10px;
            font-size: 1rem; 
            opacity: 0.6;
            animation: fadeOut 0.6s infinite linear;
            z-index: 9;
        }

        @keyframes gallop { 0% { transform: scaleX(-1) rotate(0deg) translateY(0); } 100% { transform: scaleX(-1) rotate(-5deg) translateY(-5px); } }
        @keyframes gallopDouble { 0% { transform: scaleX(-1) rotate(0deg) translateY(0); } 100% { transform: scaleX(-1) rotate(10deg) translateY(-10px); } }
        @keyframes bounce { 0% { transform: translateY(0); } 100% { transform: translateY(-5px); } }
        @keyframes fadeOut { 0% { opacity: 0.8; transform: translateX(0); } 100% { opacity: 0; transform: translateX(-20px); } }
        @keyframes float { 0%,100%{transform: translateY(0);} 50%{transform: translateY(-10px);} }

        /* 结算 */
        #view-result { position: absolute; width: 100%; height: 100%; z-index: 20; display: none; background: #1a0528; }
        .podium-container { position: absolute; top: 55%; left: 50%; transform: translate(-50%, -50%); display: flex; align-items: flex-end; gap: 20px; }
        .podium-pillar { display: flex; flex-direction: column; align-items: center; position: relative; }
        .rank-1 .pillar-box { width: 180px; height: 220px; background: linear-gradient(180deg, #9c27b0, #4a148c); border-top: 3px solid gold; font-size: 3rem; display: flex; justify-content: center; align-items: center; color: gold;}
        .rank-2 .pillar-box { width: 150px; height: 160px; background: linear-gradient(180deg, #7b1fa2, #4a148c); border-top: 3px solid silver; font-size: 2.5rem; display: flex; justify-content: center; align-items: center; color: silver;}
        .rank-3 .pillar-box { width: 150px; height: 130px; background: linear-gradient(180deg, #7b1fa2, #4a148c); border-top: 3px solid #cd7f32; font-size: 2.5rem; display: flex; justify-content: center; align-items: center; color: #cd7f32;}
        .p-avatar { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
        .avatar-box { border-radius: 50%; margin-bottom: 20px; width: 90px; height: 90px; border: 4px solid white; }
        .rank-1 .avatar-box { width: 120px; height: 120px; border-color: gold; }
        .result-controls { position: absolute; bottom: 30px; width: 100%; text-align: center; }
        .btn-round { padding: 12px 40px; border-radius: 30px; border: none; font-size: 1.2rem; cursor: pointer; color: white; background: linear-gradient(90deg, #ff4081, #f50057); }
        
        .qr-float { 
            position: absolute; top: 30px; right: 30px; 
            background: rgba(255,255,255,0.95); padding: 10px; border-radius: 10px; 
            text-align: center; color: #333; z-index: 100; 
        }
        .barrage-item { position: absolute; background: rgba(255,255,255,0.1); backdrop-filter: blur(5px); padding: 5px 15px; border-radius: 30px; color: #fff; font-size: 0.9rem; border: 1px solid rgba(255,255,255,0.3); white-space: nowrap; animation: flyRight 12s linear forwards; z-index: 5; }
        @keyframes flyRight { from { left: -20%; } to { left: 110%; } }
        
        /* 双倍得分特效 */
        .double-score-effect {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 3rem;
            font-weight: bold;
            color: gold;
            text-shadow: 0 0 10px red;
            z-index: 10000;
            pointer-events: none;
            animation: floatUp 1.5s forwards;
        }
        
        @keyframes floatUp {
            0% { opacity: 1; transform: translate(-50%, -50%); }
            100% { opacity: 0; transform: translate(-50%, -70%); }
        }
    </style>
</head>
<body>
    <div id="bg-layer">
        <!-- 核心修改：这里使用变量，确保链接被正确替换 -->
        <video autoplay muted loop playsinline webkit-playsinline class="video-bg" preload="auto">
            <source src="${BG_VIDEO_URL}" type="video/mp4">
            您的浏览器不支持视频播放。
        </video>
        <div class="video-mask"></div>
    </div>
    
    <div id="qr-box" class="qr-float">
        <img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(mobileUrl)}">
        <div style="font-size:12px; font-weight:bold; margin-top:5px">扫码加入</div>
    </div>

    <div id="countdown-overlay">
        <div id="countdown-text">3</div>
    </div>

    <!-- 1. 大厅 -->
    <div id="view-lobby">
        <div class="header-area"><h1 class="main-title" data-text="新年好运 · 锦鲤大奖赛">新年好运 · 锦鲤大奖赛</h1><div class="sub-title">摇摆 2026！& 嗨翻 2026！</div></div>
        <div class="center-bar"><button class="btn-start" onclick="startGame()">开始比赛</button></div>
        <div id="lobby-list"></div>
    </div>

    <!-- 2. 赛马场 -->
    <div id="view-race">
        <div class="track-bg-lines"></div>
        <div class="timer-panel"><div id="timer-num">30</div><div class="timer-label">冲刺倒计时</div></div>
        <div id="barrage-container" style="position:absolute; top:10%; width:100%; height:30%; overflow:hidden; pointer-events:none"></div>
        
        <div class="track-area" id="tracks"></div>
    </div>

    <!-- 3. 结果 -->
    <div id="view-result">
        <h1 style="text-align:center; font-size:4rem; margin-top:50px; color:gold; text-shadow:0 0 20px #ff00cc">🏆 最终荣耀 🏆</h1>
        <div class="podium-container" id="podium-root"></div>
        <div class="result-controls"><button class="btn-round" onclick="resetGame()">重置游戏</button></div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        const viewLobby = document.getElementById('view-lobby');
        const viewRace = document.getElementById('view-race');
        const viewResult = document.getElementById('view-result');
        const lobbyList = document.getElementById('lobby-list');
        const tracksDiv = document.getElementById('tracks');
        const timerNum = document.getElementById('timer-num');
        const podiumRoot = document.getElementById('podium-root');
        const barrageContainer = document.getElementById('barrage-container');
        const qrBox = document.getElementById('qr-box');
        const cdOverlay = document.getElementById('countdown-overlay');
        const cdText = document.getElementById('countdown-text');
        const bgLayer = document.getElementById('bg-layer');

        const TRACK_MAX_SCORE = 1000; // 与服务端保持一致

        // 页面加载完成后尝试播放视频
        document.addEventListener('DOMContentLoaded', function() {
            attemptVideoPlay();
        });

        // 页面可见性改变时尝试播放
        document.addEventListener('visibilitychange', function() {
            if (!document.hidden) {
                attemptVideoPlay();
            }
        });

        function attemptVideoPlay() {
            const video = document.querySelector('.video-bg');
            if (video) {
                // 设置必要的属性
                video.muted = true;
                video.playsInline = true;
                video.webkitPlaysInline = true;
                
                // 尝试播放
                const playPromise = video.play();
                if (playPromise !== undefined) {
                    playPromise.then(_ => {
                        console.log('视频自动播放成功');
                    }).catch(error => {
                        console.log('视频自动播放失败:', error);
                        // 如果失败，添加一个静默播放处理
                        handleAutoPlayFailure(video);
                    });
                }
            }
        }

        function handleAutoPlayFailure(video) {
            // 创建一个用户交互事件来触发播放
            const playOnInteraction = () => {
                video.play().then(() => {
                    console.log('通过用户交互成功播放视频');
                }).catch(e => {
                    console.log('通过用户交互播放视频失败:', e);
                });
                
                // 移除事件监听器
                document.removeEventListener('touchstart', playOnInteraction);
                document.removeEventListener('click', playOnInteraction);
            };
            
            // 添加一次性用户交互事件监听器
            document.addEventListener('touchstart', playOnInteraction, { once: true });
            document.addEventListener('click', playOnInteraction, { once: true });
        }

        function startGame() { 
            console.log('发送开始游戏请求');
            socket.emit('admin_start_game'); 
        }
        function resetGame() { socket.emit('admin_reset_game'); }

        function renderLobby(players) {
            let html = '';
            const totalSlots = Math.max(10, players.length + 1);
            for (let i = 0; i < totalSlots; i++) {
                const p = players[i];
                if (p) {
                    html += \`
                    <div class="slot">
                        <div class="slot-circle" style="border-color:#ffcc00; box-shadow:0 0 10px #ffcc00">
                            <img src="\${p.avatar}" class="slot-img" onerror="this.src='https://via.placeholder.com/100/333/fff?text=?'">
                        </div>
                        <div class="slot-name">\${p.name}</div>
                    </div>\`;
                } else {
                    html += \`
                    <div class="slot">
                        <div class="slot-circle slot-empty"><div style="font-size:3rem; color:white">?</div></div>
                        <div class="slot-name" style="opacity:0.6">等待加入</div>
                    </div>\`;
                }
            }
            lobbyList.innerHTML = html;
        }

        function renderTracks(players) {
            tracksDiv.innerHTML = '';
            const leaderScore = players.length > 0 ? Math.max(players[0].score, TRACK_MAX_SCORE) : TRACK_MAX_SCORE;

            players.forEach((p, idx) => {
                const lane = document.createElement('div');
                lane.className = 'lane-horse';
                lane.style.zIndex = 100 - idx; // 动态 Z-index

                // 调整移动速度，让马匹移动更慢
                let pct = (p.score / leaderScore) * 80; // 从90%减少到80%，限制最大移动距离
                if(pct > 85) pct = 85; // 从92%减少到85%

                // 检查玩家是否有双倍得分状态
                const isDoubleScore = p.hasDoubleScore ? 'double-score' : '';
                
                lane.innerHTML = \`
                    <div class="start-line"></div>
                    <div class="finish-line"></div>
                    
                    <div class="horse-runner" style="left: \${pct}%">
                        <div class="runner-name \${isDoubleScore}">\${p.name}</div>
                        <div class="horse-body \${isDoubleScore}">🏇</div>
                        <img src="\${p.avatar}" class="jockey-avatar" onerror="this.style.display='none'">
                        <div class="dust">💨</div>
                    </div>
                \`;
                tracksDiv.appendChild(lane);
            });
        }

        function renderResult(players) {
             podiumRoot.innerHTML = '';
             const top3 = players.slice(0, 3);
             const rankedPlayers = [top3[1], top3[0], top3[2]];
             const rankNumbers = [2, 1, 3];
             rankedPlayers.forEach((player, index) => {
                 if (!player) {
                     const div = document.createElement('div');
                     div.className = \`podium-pillar rank-\${rankNumbers[index]}\`;
                     div.innerHTML = \`<div class="avatar-box"><div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#333;color:#999;">?</div></div><div class="pillar-box">\${rankNumbers[index]}\`;</div>
                     podiumRoot.appendChild(div);
                     return;
                 }
                 const rank = rankNumbers[index];
                 const div = document.createElement('div');
                 div.className = \`podium-pillar rank-\${rank}\`;
                 div.innerHTML = \`<div class="avatar-box"><img src="\${player.avatar}" class="p-avatar" onerror="this.src='https://via.placeholder.com/100/333/fff?text=?'"></div><div class="pillar-box">\${rank}</div><div style="margin-top:10px; font-weight:bold">\${player.name}</div><div style="margin-top:5px; font-size:0.9rem; color:#ccc;">\${player.score} 分</div>\`;</div>
                 podiumRoot.appendChild(div);
             });
        }

        socket.on('update_players', (players) => {
            renderLobby(players);
            if(viewRace.style.display !== 'none') renderTracks(players);
        });

        socket.on('game_state_change', (state) => {
            if (state === 'waiting') {
                viewLobby.style.display = 'flex'; viewRace.style.display = 'none'; viewResult.style.display = 'none';
                qrBox.classList.remove('force-hide'); cdOverlay.style.display = 'none'; timerNum.innerText = '60';
                bgLayer.style.display = 'block';
                // 回到等待界面时重新尝试播放视频
                setTimeout(attemptVideoPlay, 100);
            } else if (state === 'countdown') {
                viewLobby.style.display = 'none'; viewRace.style.display = 'block'; viewResult.style.display = 'none';
                qrBox.classList.add('force-hide'); cdOverlay.style.display = 'flex';
            } else if (state === 'racing') {
                viewLobby.style.display = 'none'; viewRace.style.display = 'block'; viewResult.style.display = 'none';
                qrBox.classList.add('force-hide'); cdOverlay.style.display = 'none';
                bgLayer.style.display = 'none'; 
            } else if (state === 'finished') {
                viewRace.style.display = 'none'; viewResult.style.display = 'block'; qrBox.classList.add('force-hide');
                bgLayer.style.display = 'none'; 
            }
        });

        socket.on('countdown_tick', (count) => {
            cdText.innerText = count > 0 ? count : 'GO!';
            // 重置动画
            cdText.style.animation = 'none';
            cdText.offsetHeight; // 触发重排
            cdText.style.animation = 'popIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        });

        socket.on('time_update', (sec) => { timerNum.innerText = sec; });
        socket.on('game_over', (finalPlayers) => {
            viewRace.style.display = 'none'; viewResult.style.display = 'block';
            renderResult(finalPlayers);
            confetti({ particleCount: 200, spread: 100, origin: { y: 0.6 } });
        });
        socket.on('new_barrage', (data) => {
            if(viewRace.style.display === 'none') return;
            const item = document.createElement('div');
            item.className = 'barrage-item';
            item.innerHTML = \`<img src="\${data.avatar}" style="width:20px;height:20px;border-radius:50%;vertical-align:middle" onerror="this.style.display='none'"> \${data.text}\`;
            item.style.top = Math.random() * 80 + '%';
            barrageContainer.appendChild(item);
            setTimeout(()=>item.remove(), 12000);
        });
        
        // 监听双倍得分事件
        socket.on('double_score_effect', () => {
            showDoubleScoreEffect();
        });
        
        // 显示双倍得分特效
        function showDoubleScoreEffect() {
            const effect = document.createElement('div');
            effect.className = 'double-score-effect';
            effect.textContent = 'DOUBLE SCORE!';
            document.body.appendChild(effect);
            
            setTimeout(() => {
                effect.remove();
            }, 1500);
        }
        
        renderLobby([]);
    </script>
</body>
</html>
    `);
});

// --- 手机端保持不变 ---
function renderMobilePage(userInfo) {
    const userJson = JSON.stringify({ nickname: userInfo.nickname, headimgurl: userInfo.headimgurl, openid: userInfo.openid });
    return `
    <!DOCTYPE html>
    <html lang="zh">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
        <title>龙马精神</title>
        <style>
             body { margin: 0; padding: 0; overflow: hidden; background: linear-gradient(135deg, #1e6b36 0%, #0d3819 100%); font-family: sans-serif; color: #fff; text-align: center; height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; }
            .avatar { width: 80px; height: 80px; border-radius: 50%; border: 3px solid gold; margin-bottom: 20px; box-shadow: 0 0 15px gold; }
            .btn { background: linear-gradient(90deg, #ffd700, #ff8c00); color: #8b0000; border: none; padding: 15px 50px; border-radius: 50px; font-size: 1.2rem; font-weight: bold; box-shadow: 0 0 20px rgba(255, 215, 0, 0.5); }
            #shake-icon { font-size: 5rem; margin: 20px; filter: drop-shadow(0 0 10px gold); }
            .hidden { display: none; }
            
            /* 双倍得分动画 */
            @keyframes doubleShake {
                0% { transform: scale(1); }
                50% { transform: scale(1.2); }
                100% { transform: scale(1); }
            }
            
            .double-score {
                animation: doubleShake 0.5s ease-in-out;
                color: gold;
                text-shadow: 0 0 10px red;
            }
        </style>
    </head>
    <body>
        <div id="setup"><img src="${userInfo.headimgurl}" class="avatar" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIiB2aWV3Qm94PSIwIDAgMTAwIDEwMCI+PGNpcmNsZSBjeD0iNTAiIGN5PSI0MCIgcj0iMjAiIGZpbGw9IiNmZmYiLz48Y2lyY2xlIGN4PSI1MCIgY3k9IjgwIiByPSIzMCIgZmlsbD0iI2ZmZiIvPjwvc3ZnPg=='"><h2>${userInfo.nickname}</h2><button class="btn" onclick="join()">🚀 上马参战</button></div>
        <div id="game" class="hidden"><h2 id="status">等待发令...</h2><div id="shake-icon">🏇</div></div>
        <script src="/socket.io/socket.io.js"></script>
        <script>
            const socket = io();
            const user = ${userJson};
            const shakeIcon = document.getElementById('shake-icon');
            
            async function join() {
                if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') { try { await DeviceMotionEvent.requestPermission(); } catch(e){} }
                socket.emit('join_game', user);
                document.getElementById('setup').classList.add('hidden');
                document.getElementById('game').classList.remove('hidden');
                let last = 0;
                window.addEventListener('devicemotion', e => {
                    const now = Date.now();
                    if(now - last > 100) {
                        let acc = e.acceleration || e.accelerationIncludingGravity;
                        if((Math.abs(acc.x)+Math.abs(acc.y)+Math.abs(acc.z)) > 15) {
                            socket.emit('shake');
                            last = now;
                            if(navigator.vibrate) navigator.vibrate(50);
                            
                            // 添加摇动动画效果
                            shakeIcon.classList.remove('double-score');
                            void shakeIcon.offsetWidth; // 触发重绘
                            shakeIcon.classList.add('double-score');
                        }
                    }
                });
                socket.on('game_state_change', s => {
                    if(s==='racing') document.getElementById('status').innerText = '策马奔腾！';
                    if(s==='finished') document.getElementById('status').innerText = '冲线成功';
                });
                
                // 监听双倍得分事件
                socket.on('double_score', () => {
                    // 添加双倍得分视觉效果
                    document.getElementById('status').textContent = '双倍得分!';
                    document.getElementById('status').style.color = 'gold';
                    document.getElementById('status').style.textShadow = '0 0 10px red';
                    
                    // 2秒后恢复原状
                    setTimeout(() => {
                        document.getElementById('status').textContent = '策马奔腾！';
                        document.getElementById('status').style.color = '';
                        document.getElementById('status').style.textShadow = '';
                    }, 2000);
                });
            }
        </script>
    </body>
    </html>
    `;
}

// 添加错误处理
app.use((err, req, res, next) => {
    console.error('服务器错误:', err);
    res.status(500).send('内部服务器错误');
});

http.listen(PORT, '0.0.0.0', () => {
    console.log('Server running on port ' + PORT);
});
