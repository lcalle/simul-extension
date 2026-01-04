
// content.js
// Injected into Max.com. Interacts with the <video> tag AND provides the Visual Overlay.
// Uses Long-Lived Ports for robust connection + Session Storage for persistence.

if (window.simulInjected) {
  console.log('[SIMUL] Content script already running.');
} else {
  window.simulInjected = true;
  initContentScript();
}

function initContentScript() {
    let videoElement = null;
    let isRemoteUpdate = false;
    let isUnSync = false; // Local Playback Mode
    let lastServerState = { time: 0, status: 'paused', updatedAt: Date.now() }; // Track global room state
    
    // UI Refs
    let overlayRef = null;
    let chatContainerRef = null;
    let statusTextRef = null; 
    let statusDotRef = null; 
    let secureIconRef = null; // Lock Icon
    
    // Control Refs
    let playPauseBtnRef = null;
    let toggleSwitchRef = null;
    let toggleLabelRef = null;
    
    let dashboardRef = null;
    let usersContainerRef = null;
    let statsContainerRef = null;
    
    // Analytics State
    let stats = {
        startTime: Date.now(),
        chats: 0,
        syncs: 0,
        reactions: 0
    };
    let statsInterval = null;
    
    // Connection State
    let port = null;
    let reconnectTimer = null;
    let pendingSync = null;
    
    let session = {
        roomId: sessionStorage.getItem('simul_room_id') || '',
        userId: sessionStorage.getItem('simul_user_id') || '',
        url: sessionStorage.getItem('simul_ws_url') || ''
    };

    // --- CRYPTO ENGINE (Vanilla JS Port) ---
    const cryptoEngine = {
        key: null,
        ivLength: 12,
        async init(secret) {
            if (!window.crypto || !window.crypto.subtle) return false;
            try {
                const enc = new TextEncoder();
                const keyMaterial = await window.crypto.subtle.importKey(
                    "raw", enc.encode(secret), { name: "PBKDF2" }, false, ["deriveBits", "deriveKey"]
                );
                this.key = await window.crypto.subtle.deriveKey(
                    { name: "PBKDF2", salt: enc.encode("SIMUL_SALT_v1"), iterations: 100000, hash: "SHA-256" },
                    keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
                );
                return true;
            } catch(e) { console.error('Crypto Init Failed', e); return false; }
        },
        async encrypt(text) {
            if (!this.key) return text;
            try {
                const enc = new TextEncoder();
                const iv = window.crypto.getRandomValues(new Uint8Array(12));
                const ciphertext = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, this.key, enc.encode(text));
                
                // Combine IV + Ciphertext
                const ivArr = new Uint8Array(iv);
                const cipherArr = new Uint8Array(ciphertext);
                const combined = new Uint8Array(ivArr.length + cipherArr.length);
                combined.set(ivArr);
                combined.set(cipherArr, ivArr.length);
                
                // ArrayBuffer to Base64 manually
                let binary = '';
                for (let i = 0; i < combined.byteLength; i++) binary += String.fromCharCode(combined[i]);
                return btoa(binary);
            } catch(e) { return text; }
        },
        async decrypt(text) {
             if (!this.key) return text;
             try {
                 const binary = atob(text);
                 const len = binary.length;
                 const combined = new Uint8Array(len);
                 for (let i = 0; i < len; i++) combined[i] = binary.charCodeAt(i);

                 if (combined.byteLength < 12) return text;
                 const iv = combined.slice(0, 12);
                 const data = combined.slice(12);
                 
                 const decrypted = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, this.key, data);
                 return new TextDecoder().decode(decrypted);
             } catch(e) { return text; }
        },
        isSecure() { return !!(window.crypto && window.crypto.subtle); }
    };

    console.log('[SIMUL] Content Script Loaded.');

    function initPort() {
        try {
            if (port) { try { port.disconnect(); } catch(e){} }
            port = chrome.runtime.connect({ name: 'simul-lifecycle' });
            port.onMessage.addListener(handlePortMessage);
            port.onDisconnect.addListener(() => {
                setNetworkStatus(false);
                updatePlaybackText('OFFLINE', '#666');
                port = null;
                if (reconnectTimer) clearTimeout(reconnectTimer);
                reconnectTimer = setTimeout(initPort, 2000);
            });
            
            if (session.roomId && session.userId && session.url) {
                 setTimeout(() => {
                     if(port) {
                        port.postMessage({
                            type: 'CONNECT',
                            url: session.url,
                            roomId: session.roomId,
                            userId: session.userId
                        });
                     }
                 }, 300);
            }
        } catch (e) { console.error('[SIMUL] Port Init Error', e); }
    }
    initPort();

    const sendAnalytics = () => {
        if (!port) return;
        const payload = {
            duration: Math.floor((Date.now() - stats.startTime) / 1000),
            events: { chats: stats.chats, syncs: stats.syncs, reactions: stats.reactions, drifts: 0 },
            reactionCounts: {},
            startTime: stats.startTime
        };
        try { port.postMessage({ type: 'ANALYTICS', payload }); } catch(e) {}
    };

    setInterval(sendAnalytics, 10000); 
    window.addEventListener('beforeunload', sendAnalytics); 

    const checkVideo = () => {
        const v = document.querySelector('video');
        if (v && v !== videoElement) {
            videoElement = v;
            attachListeners(videoElement);
            if (pendingSync) { applySync(pendingSync); pendingSync = null; }
        }
    };
    const observer = new MutationObserver(checkVideo);
    observer.observe(document.body, { childList: true, subtree: true });
    setInterval(checkVideo, 2000);

    function attachListeners(video) {
        const sendAction = (action) => {
            if (isRemoteUpdate || !port || isUnSync) return; // UnSync Guard
            port.postMessage({ type: 'ACTION', payload: { action, time: video.currentTime, videoService: 'max' } });
        };

        const updatePlayPauseVisual = () => {
             if (playPauseBtnRef) {
                 const isPaused = video.paused;
                 // Play Icon
                 const playIcon = '<svg width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z"/></svg>';
                 // Pause Icon
                 const pauseIcon = '<svg width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5zm5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5z"/></svg>';
                 
                 playPauseBtnRef.innerHTML = isPaused ? playIcon : pauseIcon;
             }
        };

        video.addEventListener('play', () => { 
            updatePlayPauseVisual();
            if(!isUnSync) { updatePlaybackText(`PLAYING by Me`, '#22c55e'); sendAction('play'); }
        });
        video.addEventListener('pause', () => { 
            updatePlayPauseVisual();
            if(!isUnSync) { updatePlaybackText(`PAUSED by Me`, '#fbbf24'); sendAction('pause'); }
        });
        video.addEventListener('seeked', () => {
            if(!isUnSync) sendAction('match');
        });
        
        // Initial state update
        updatePlayPauseVisual();
    }

    async function handlePortMessage(msg) {
        if (msg.type === 'PING') return; 

        if (msg.type === 'CONNECTED') {
            session.roomId = msg.roomId;
            session.userId = msg.userId;
            sessionStorage.setItem('simul_room_id', msg.roomId);
            sessionStorage.setItem('simul_user_id', msg.userId);
            
            // Init Crypto with RoomID as secret
            await cryptoEngine.init(msg.roomId);
            
            createOverlay(msg.roomId);
            setNetworkStatus(true);
            updatePlaybackText('READY', '#fff');
            updateSecureUI();
            return;
        }

        if (msg.type === 'chat') { 
            stats.chats++;
            updateStatsUI();
            
            // Decrypt
            const plainText = await cryptoEngine.decrypt(msg.payload.text);
            msg.payload.text = plainText;
            
            addChatMessage(msg.payload); 
            return; 
        }
        
        if (msg.type === 'user_list') { updateUserList(msg.payload); return; }

        if (msg.type === 'reaction') { 
            stats.reactions++;
            updateStatsUI();
            playAnimation(msg.payload.id); 
            return; 
        }

        if (msg.type === 'STATUS') {
            if (msg.status === 'connected') setNetworkStatus(true);
            else if (msg.status === 'disconnected') setNetworkStatus(false);
            return;
        }

        if (msg.type === 'action' || msg.type === 'sync') {
            // TRACK SERVER STATE (Independent of local UnSync status)
            const p = msg.payload;
            lastServerState = {
                time: p.time,
                status: p.status || (p.action === 'play' ? 'playing' : (p.action === 'pause' ? 'paused' : 'stopped')),
                updatedAt: Date.now()
            };

            if (isUnSync) return; // Block incoming sync in UnSync mode
            if (!videoElement) {
                if (msg.type === 'sync') pendingSync = msg.payload;
                return;
            }
            applySync(msg.payload);
        }
    }
    
    function applySync(payload) {
        stats.syncs++;
        updateStatsUI();

        const { action, time, status, updatedBy } = payload || {};
        isRemoteUpdate = true; 
        let byUser = '';
        if (updatedBy && updatedBy !== 'system') byUser = ` by ${updatedBy}`;

        if (status === 'playing' || action === 'play') updatePlaybackText(`PLAYING${byUser}`, '#22c55e');
        else if (status === 'paused' || action === 'pause') updatePlaybackText(`PAUSED${byUser}`, '#fbbf24');
        else if (status === 'stopped') updatePlaybackText(`STOPPED${byUser}`, '#ef4444');

        const drift = Math.abs(videoElement.currentTime - time);
        if (drift > 2.0) videoElement.currentTime = time;
        else if (drift > 0.5 && isTimeBuffered(videoElement, time)) videoElement.currentTime = time;

        if ((action === 'play' || status === 'playing') && videoElement.paused) videoElement.play().catch(console.error);
        else if ((action === 'pause' || status === 'paused') && !videoElement.paused) videoElement.pause();

        setTimeout(() => { isRemoteUpdate = false; }, 800);
    }

    function isTimeBuffered(video, time) {
        try {
            for (let i = 0; i < video.buffered.length; i++) {
                if (time >= video.buffered.start(i) && time <= video.buffered.end(i)) return true;
            }
        } catch(e) { return false; }
        return false;
    }
    
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.type === 'PING') { sendResponse({ pong: true }); return; }
        if (msg.type === 'CONNECT') {
            if (!port) initPort();
            session.url = msg.url;
            sessionStorage.setItem('simul_ws_url', msg.url);
            setTimeout(() => { if(port) port.postMessage({ type: 'CONNECT', url: msg.url, roomId: msg.roomId, userId: msg.userId }); }, 100);
            sendResponse({ success: true });
        }
    });

    function createOverlay(roomId) {
        if (document.getElementById('simul-overlay')) return;

        // INJECT CSS FOR ANIMATION
        const style = document.createElement('style');
        style.innerHTML = `
            @keyframes simulSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
            @keyframes simulThrow { 
                0% { transform: translate(-100px, 100px) scale(0.5); opacity: 1; }
                50% { transform: translate(0, 0) scale(1); opacity: 1; }
                60% { transform: translate(0, 0) scale(1.5) rotate(20deg); opacity: 1; }
                90% { transform: translate(0, 0) scale(1.5) rotate(20deg); opacity: 1; }
                100% { transform: translate(0, 0) scale(2) opacity: 0; }
            }
            .simul-stat-row { display: flex; justify-content: space-between; color: #aaa; margin-bottom: 4px; }
            .simul-stat-val { color: #fff; font-family: monospace; }
        `;
        document.head.appendChild(style);

        const div = document.createElement('div');
        div.id = 'simul-overlay';
        div.style.cssText = `position: fixed; bottom: 100px; right: 30px; width: 320px; height: 450px; background-color: rgba(10, 10, 10, 0.95); border: 1px solid #333; border-radius: 12px; z-index: 2147483647; font-family: sans-serif; color: #e5e5e5; box-shadow: 0 10px 40px rgba(0,0,0,0.9); display: flex; flex-direction: column; overflow: hidden; backdrop-filter: blur(10px); transition: height 0.3s ease, opacity 0.2s;`;
        
        const header = document.createElement('div');
        header.style.cssText = 'padding: 12px; background: rgba(255,255,255,0.05); display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333;';
        header.innerHTML = `<div><span style="color:#e50914; font-weight:900;">SIMUL</span> <span style="font-size:10px; color:#666; font-family:monospace;">${roomId}</span></div>`;
        
        const headerControls = document.createElement('div');
        headerControls.style.cssText = 'display:flex; align-items:center;';

        // Secure Icon
        secureIconRef = document.createElement('div');
        secureIconRef.style.cssText = 'margin-right: 8px; font-size: 14px;';
        headerControls.appendChild(secureIconRef);

        // Tomato Button (Header)
        const tomatoBtn = document.createElement('button');
        tomatoBtn.innerText = '🍅';
        tomatoBtn.style.cssText = 'background:none; border:none; font-size:16px; cursor:pointer; margin-right:10px; transition: transform 0.1s;';
        tomatoBtn.title = 'Throw Tomato';
        tomatoBtn.onmousedown = () => tomatoBtn.style.transform = 'scale(0.9)';
        tomatoBtn.onmouseup = () => tomatoBtn.style.transform = 'scale(1)';
        tomatoBtn.onclick = () => {
             if(port) {
                 stats.reactions++;
                 updateStatsUI();
                 port.postMessage({ type: 'REACTION', payload: { id: 'tomato' } });
                 playAnimation('tomato');
             }
        };
        headerControls.appendChild(tomatoBtn);

        // User Count Badge
        const userCount = document.createElement('div');
        userCount.id = 'simul-user-count';
        userCount.innerText = '1 Online';
        userCount.style.cssText = 'font-size:10px; color:#aaa; margin-right:10px; cursor:pointer;';
        userCount.onclick = () => {
            if (dashboardRef.style.display === 'none') {
                dashboardRef.style.display = 'block';
                // Start Timer
                if(!statsInterval) statsInterval = setInterval(updateStatsUI, 1000);
            } else {
                dashboardRef.style.display = 'none';
                // Stop Timer
                if(statsInterval) { clearInterval(statsInterval); statsInterval = null; }
            }
        };
        headerControls.appendChild(userCount);

        const minBtn = document.createElement('button');
        minBtn.innerText = '−';
        minBtn.style.cssText = 'background:none; border:none; color:#999; font-size:18px; cursor:pointer; padding:0 4px;';
        minBtn.onclick = () => {
            if (div.style.height === '40px') { div.style.height = '450px'; div.style.opacity = '1'; }
            else { div.style.height = '40px'; div.style.opacity = '0.6'; }
        };
        headerControls.appendChild(minBtn);
        
        header.appendChild(headerControls);
        div.appendChild(header);

        // DASHBOARD (User List + Analytics)
        dashboardRef = document.createElement('div');
        dashboardRef.style.cssText = 'display:none; background:#111; padding:8px; border-bottom:1px solid #333; max-height:150px; overflow-y:auto; font-size:11px;';
        
        // Users Section
        const usersLabel = document.createElement('div');
        usersLabel.innerText = "ACTIVE VIEWERS";
        usersLabel.style.cssText = "font-weight:bold; color:#555; margin-bottom:4px; font-size:9px;";
        dashboardRef.appendChild(usersLabel);
        
        usersContainerRef = document.createElement('div');
        usersContainerRef.style.marginBottom = '8px';
        dashboardRef.appendChild(usersContainerRef);
        
        // Analytics Section
        const statsLabel = document.createElement('div');
        statsLabel.innerText = "SESSION ANALYTICS";
        statsLabel.style.cssText = "font-weight:bold; color:#e50914; margin-bottom:4px; font-size:9px; border-top: 1px solid #222; padding-top:4px;";
        dashboardRef.appendChild(statsLabel);
        
        statsContainerRef = document.createElement('div');
        dashboardRef.appendChild(statsContainerRef);

        div.appendChild(dashboardRef);

        const statusContainer = document.createElement('div');
        statusContainer.style.cssText = 'padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; background: #000; font-size: 10px; font-weight: bold;';
        const netContainer = document.createElement('div');
        netContainer.style.display = 'flex'; netContainer.style.alignItems = 'center'; netContainer.style.gap = '6px';
        statusDotRef = document.createElement('div');
        statusDotRef.style.cssText = 'width: 6px; height: 6px; border-radius: 50%; background: #444; box-shadow: 0 0 5px rgba(0,0,0,0.5);';
        netContainer.appendChild(statusDotRef);
        netContainer.appendChild(document.createTextNode('NET'));
        statusContainer.appendChild(netContainer);
        statusTextRef = document.createElement('span');
        statusTextRef.innerText = 'WAITING...';
        statusTextRef.style.color = '#888';
        statusContainer.appendChild(statusTextRef);
        div.appendChild(statusContainer);

        // --- PLAYBACK CONTROLS ---
        const playbackBar = document.createElement('div');
        playbackBar.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 12px; border-bottom: 1px solid #333; background: #151515; gap: 12px;';

        // 1. PLAY/PAUSE
        playPauseBtnRef = document.createElement('button');
        playPauseBtnRef.innerHTML = videoElement && !videoElement.paused 
            ? '<svg width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5zm5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5z"/></svg>'
            : '<svg width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z"/></svg>';
        playPauseBtnRef.style.cssText = 'flex: 1; height: 36px; background: #333; border: 1px solid #444; color: white; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.2s;';
        playPauseBtnRef.title = "Play/Pause Video";
        playPauseBtnRef.onclick = () => {
            if (!videoElement) return;
            if (videoElement.paused) videoElement.play();
            else videoElement.pause();
        };
        playPauseBtnRef.onmouseover = () => playPauseBtnRef.style.background = '#444';
        playPauseBtnRef.onmouseout = () => playPauseBtnRef.style.background = '#333';

        // 2. UNSYNC TOGGLE
        const toggleContainer = document.createElement('div');
        toggleContainer.style.cssText = 'flex: 1; height: 36px; display: flex; align-items: center; justify-content: center; background: #222; border: 1px solid #333; border-radius: 6px; gap: 8px; cursor: pointer; padding: 0 8px; transition: background 0.2s;';
        toggleContainer.title = "Toggle Sync Mode";
        toggleContainer.onclick = () => {
            isUnSync = !isUnSync;
            updateUnSyncUI();
        };

        toggleLabelRef = document.createElement('span');
        toggleLabelRef.innerText = 'SYNCED';
        toggleLabelRef.style.cssText = 'font-size: 10px; font-weight: bold; color: #22c55e; letter-spacing: 1px; transition: color 0.2s;';

        const switchTrack = document.createElement('div');
        switchTrack.style.cssText = 'position: relative; width: 24px; height: 14px; background: #444; border-radius: 10px; transition: background 0.2s;';
        
        toggleSwitchRef = document.createElement('div');
        toggleSwitchRef.style.cssText = 'position: absolute; top: 2px; left: 2px; width: 10px; height: 10px; background: #fff; border-radius: 50%; transition: transform 0.2s;';
        
        switchTrack.appendChild(toggleSwitchRef);
        toggleContainer.appendChild(toggleLabelRef);
        toggleContainer.appendChild(switchTrack);

        // 3. MATCH
        const matchBtn = document.createElement('button');
        matchBtn.innerText = 'MATCH';
        matchBtn.style.cssText = 'flex: 1; height: 36px; background: #e50914; border: none; color: white; border-radius: 6px; font-weight: bold; font-size: 11px; cursor: pointer; transition: background 0.2s; letter-spacing: 0.5px;';
        matchBtn.title = "Pull room state to local player";
        matchBtn.onclick = () => {
            if (!videoElement) return;
            let target = lastServerState.time;
            if (lastServerState.status === 'playing') {
                const elapsed = (Date.now() - lastServerState.updatedAt) / 1000;
                target += elapsed;
            }
            videoElement.currentTime = target;
            if (lastServerState.status === 'playing') videoElement.play().catch(()=>{});
            else videoElement.pause();
            
            // Visual feedback
            const oldBg = matchBtn.style.background;
            matchBtn.style.background = '#fff';
            matchBtn.style.color = '#e50914';
            setTimeout(() => {
                matchBtn.style.background = oldBg;
                matchBtn.style.color = '#fff';
            }, 200);
        };
        matchBtn.onmouseover = () => matchBtn.style.background = '#b2070f';
        matchBtn.onmouseout = () => matchBtn.style.background = '#e50914';

        playbackBar.appendChild(playPauseBtnRef);
        playbackBar.appendChild(toggleContainer);
        playbackBar.appendChild(matchBtn);
        div.appendChild(playbackBar);

        chatContainerRef = document.createElement('div');
        chatContainerRef.style.cssText = 'flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; background: rgba(0,0,0,0.3);';
        div.appendChild(chatContainerRef);

        const inputContainer = document.createElement('form');
        inputContainer.style.cssText = 'padding: 8px; border-top: 1px solid #333; background: #111;';
        const input = document.createElement('input');
        input.placeholder = 'Type a message...';
        input.style.cssText = 'width: 100%; background: #222; border: 1px solid #333; color: #fff; padding: 8px 10px; border-radius: 4px; font-size: 12px; box-sizing: border-box; outline: none;';
        inputContainer.onsubmit = async (e) => {
            e.preventDefault();
            if (input.value.trim() && port) {
                const plainText = input.value.trim();
                
                // Encrypt before sending
                const cipherText = await cryptoEngine.encrypt(plainText);
                
                const msg = { id: Date.now().toString(), userId: session.userId, text: cipherText, timestamp: Date.now() };
                port.postMessage({ type: 'CHAT', payload: msg });
                
                // Show local plain text
                msg.text = plainText;
                addChatMessage(msg);
                stats.chats++;
                updateStatsUI();
                input.value = '';
            }
        };
        inputContainer.appendChild(input);
        div.appendChild(inputContainer);
        document.body.appendChild(div);
        
        // Initial Stats Render
        updateStatsUI();
        updateSecureUI();
        updateUnSyncUI();
    }

    function updateUnSyncUI() {
        if (!toggleSwitchRef || !toggleLabelRef) return;
        if (isUnSync) {
            toggleLabelRef.innerText = 'UNSYNC';
            toggleLabelRef.style.color = '#fbbf24';
            toggleSwitchRef.style.transform = 'translateX(10px)';
            toggleSwitchRef.parentElement.style.background = '#fbbf24';
            updatePlaybackText('LOCAL ONLY', '#fbbf24');
        } else {
            toggleLabelRef.innerText = 'SYNCED';
            toggleLabelRef.style.color = '#22c55e';
            toggleSwitchRef.style.transform = 'translateX(0)';
            toggleSwitchRef.parentElement.style.background = '#444';
            updatePlaybackText('READY', '#fff');
        }
    }

    function updateSecureUI() {
        if (!secureIconRef) return;
        if (cryptoEngine.isSecure()) {
            secureIconRef.innerHTML = '🔒';
            secureIconRef.title = 'End-to-End Encrypted';
            secureIconRef.style.filter = 'grayscale(0)';
        } else {
            secureIconRef.innerHTML = '🔓';
            secureIconRef.title = 'Unsecured Connection';
            secureIconRef.style.filter = 'grayscale(100%)';
        }
    }

    function formatDuration(sec) {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}m ${s}s`;
    }

    function updateStatsUI() {
        if(!statsContainerRef) return;
        const duration = Math.floor((Date.now() - stats.startTime)/1000);
        
        statsContainerRef.innerHTML = `
            <div class="simul-stat-row"><span>Duration</span> <span class="simul-stat-val">${formatDuration(duration)}</span></div>
            <div class="simul-stat-row"><span>Chats</span> <span class="simul-stat-val">${stats.chats}</span></div>
            <div class="simul-stat-row"><span>Syncs</span> <span class="simul-stat-val">${stats.syncs}</span></div>
        `;
    }

    function addChatMessage(msg) {
        if (!chatContainerRef) return;
        const existingMsg = Array.from(chatContainerRef.children).find(child => child.dataset.id === msg.id);
        if (existingMsg) return;
        if (msg.userId === 'SYSTEM') {
            const sysDiv = document.createElement('div');
            sysDiv.style.cssText = 'text-align: center; color: #666; font-size: 10px; font-style: italic; margin: 4px 0;';
            sysDiv.innerText = msg.text;
            chatContainerRef.appendChild(sysDiv);
            chatContainerRef.scrollTop = chatContainerRef.scrollHeight;
            return;
        }
        const isMe = msg.userId === session.userId;
        const wrapper = document.createElement('div');
        wrapper.dataset.id = msg.id;
        wrapper.style.cssText = `display: flex; flex-direction: column; align-items: ${isMe ? 'flex-end' : 'flex-start'};`;
        const bubble = document.createElement('div');
        bubble.style.cssText = `max-width: 85%; padding: 6px 10px; border-radius: 8px; font-size: 12px; line-height: 1.4; background: ${isMe ? '#e50914' : '#333'}; color: ${isMe ? '#fff' : '#ddd'}; border: 1px solid ${isMe ? '#b2070f' : '#444'}; box-shadow: 0 1px 2px rgba(0,0,0,0.3);`;
        bubble.innerText = msg.text;
        const time = document.createElement('span');
        time.style.cssText = 'font-size: 9px; color: #666; margin-top: 2px; margin-right: 2px;';
        time.innerText = isMe ? 'Me' : msg.userId; 
        wrapper.appendChild(bubble);
        wrapper.appendChild(time);
        chatContainerRef.appendChild(wrapper);
        chatContainerRef.scrollTop = chatContainerRef.scrollHeight;
    }

    function updateUserList(users) {
        if (!usersContainerRef) return;
        const countLabel = document.getElementById('simul-user-count');
        if (countLabel) countLabel.innerText = `${users.length} Online`;
        
        usersContainerRef.innerHTML = '';
        users.forEach(u => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; align-items:center; padding:4px; border-bottom:1px solid #222; color:#ccc;';
            row.innerHTML = `<div style="width:6px;height:6px;background:#22c55e;border-radius:50%;margin-right:8px;"></div> ${u.name}`;
            usersContainerRef.appendChild(row);
        });
    }

    function playAnimation(type) {
        if (type === 'tomato') {
            const container = document.createElement('div');
            container.style.cssText = 'position:fixed; inset:0; pointer-events:none; z-index:2147483647; display:flex; justify-content:center; align-items:center;';
            
            // Rabbit
            const rabbit = document.createElement('div');
            rabbit.innerText = '🐇';
            rabbit.style.cssText = 'position:absolute; bottom:0; left:10%; font-size:100px; animation: simulSlideUp 0.5s ease-out forwards;';
            
            // Tomato
            const tomato = document.createElement('div');
            tomato.innerText = '🍅';
            tomato.style.cssText = 'position:absolute; font-size:80px; animation: simulThrow 1.5s ease-in-out forwards;';
            
            container.appendChild(rabbit);
            container.appendChild(tomato);
            document.body.appendChild(container);
            
            setTimeout(() => document.body.removeChild(container), 2000);
        }
    }

    function setNetworkStatus(connected) {
        if (statusDotRef) {
            statusDotRef.style.background = connected ? '#22c55e' : '#ef4444';
            statusDotRef.style.boxShadow = connected ? '0 0 8px #22c55e' : 'none';
        }
    }

    function updatePlaybackText(text, color) {
        if (statusTextRef) {
            statusTextRef.innerText = text;
            statusTextRef.style.color = color;
        }
    }
}

