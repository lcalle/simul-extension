document.addEventListener('DOMContentLoaded', () => {
  const roomInput = document.getElementById('roomId');
  const userInput = document.getElementById('userId');
  const btn = document.getElementById('connectBtn');
  const statusDiv = document.getElementById('status');
  const errorDiv = document.getElementById('errorMsg');

  // Hardcoded production server URL - Hidden from User UI
  const SERVER_URL = 'wss://simul.watch';

  const PEOPLES = [
    'Bird Grinnell',
    'Theo Roosevelt',
    'Bob Marshall',
    'Mardy Murie',
    'Aldo Leopol',
    'Ansel Adams'
  ];

  // Load saved settings for persistence
  chrome.storage.local.get(['simul_room', 'simul_userid'], (result) => {
    if (result.simul_room) roomInput.value = result.simul_room;
    
    if (result.simul_userid) {
        userInput.value = result.simul_userid;
    } else {
        const randomSuspect = PEOPLES[Math.floor(Math.random() * PEOPLES.length)];
        userInput.value = randomSuspect;
    }
  });

  const showError = (msg) => {
    errorDiv.style.display = 'block';
    errorDiv.innerText = msg;
    setTimeout(() => { errorDiv.style.display = 'none'; }, 5000);
  };

  btn.addEventListener('click', () => {
    const roomId = roomInput.value.trim();
    let userId = userInput.value.trim();
    
    if (!roomId || !userId) {
        showError('Name and Room Code are required');
        return;
    }

    // Save for next launch
    chrome.storage.local.set({ 
        'simul_room': roomId, 
        'simul_userid': userId 
    });
    
    statusDiv.innerText = 'Connecting...';
    errorDiv.style.display = 'none';

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || tabs.length === 0) {
            statusDiv.innerText = 'Error: No active tab';
            return;
        }
        const currentTabId = tabs[0].id;

        const sendConnect = () => {
            chrome.tabs.sendMessage(currentTabId, {
                type: 'CONNECT',
                url: SERVER_URL,
                roomId: roomId,
                userId: userId
            }, (response) => {
                if (chrome.runtime.lastError) {
                    showError('Could not communicate. Try refreshing the page.');
                }
            });
        };
        
        chrome.tabs.sendMessage(currentTabId, { type: 'PING' }, (response) => {
            if (chrome.runtime.lastError || !response || !response.pong) {
                chrome.scripting.executeScript({
                    target: { tabId: currentTabId },
                    files: ['content.js']
                }, () => {
                    setTimeout(sendConnect, 300);
                });
            } else {
                sendConnect();
            }
        });
    });
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'STATUS') {
      if (msg.status === 'connected') {
        statusDiv.innerText = '● Connected';
        statusDiv.style.color = '#0f0';
      } else if (msg.status === 'error') {
        statusDiv.innerText = 'Connection Failed';
        statusDiv.style.color = '#ef4444';
        showError(`Could not reach server`);
      } else {
        statusDiv.innerText = 'Disconnected';
        statusDiv.style.color = '#888';
      }
    }
  });
});
