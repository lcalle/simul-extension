
// background.js
// Handles WebSocket connections using Long-Lived Ports.
// This ensures every Tab has a dedicated, persistent link to the Server.

const sessions = new Map(); // Key: tabId, Value: { port: Port, socket: WebSocket }

// Listen for the "Lifeline" connection from Content Script
chrome.runtime.onConnect.addListener((port) => {
  // Only accept connections from our content script
  if (port.name !== 'simul-lifecycle') return;

  const tabId = port.sender.tab.id;
  console.log(`[Tab ${tabId}] Port Connected`);

  // Handle Messages coming DOWN the Port (From Content Script)
  port.onMessage.addListener((msg) => {
    
    // 1. CONNECT REQUEST
    if (msg.type === 'CONNECT') {
      setupWebSocket(tabId, port, msg.url, msg.roomId, msg.userId);
    }

    // 2. USER ACTIONS (Play/Pause/Chat/Reaction/Analytics)
    else if (msg.type === 'ACTION' || msg.type === 'CHAT' || msg.type === 'REACTION' || msg.type === 'ANALYTICS') {
      const session = sessions.get(tabId);
      // Use 1 for OPEN state to be safe against environment quirks
      if (session && session.socket && session.socket.readyState === 1) { 
        session.socket.send(JSON.stringify({
          type: msg.type.toLowerCase(),
          payload: msg.payload
        }));
      } else {
          console.warn(`[Tab ${tabId}] Failed to send ${msg.type} - Socket not open.`);
      }
    }
  });

  // Handle Port Disconnection (Tab closed or reloaded)
  port.onDisconnect.addListener(() => {
    console.log(`[Tab ${tabId}] Port Disconnected. Scheduling cleanup.`);
    // Give a 500ms grace period for any final messages (like ANALYTICS) to process 
    // before severing the WebSocket connection. This fixes race conditions on tab close.
    setTimeout(() => {
        closeSession(tabId);
    }, 500);
  });
});

function setupWebSocket(tabId, port, url, roomId, userId) {
  // Close any existing socket for this tab
  closeSession(tabId);

  // Ensure protocol matches
  const wsUrl = `${url}?roomId=${roomId}&userId=${userId}`;
  console.log(`[Tab ${tabId}] WS Connecting: ${wsUrl}`);

  try {
    const socket = new WebSocket(wsUrl);

    // Save the session
    sessions.set(tabId, { port, socket });

    socket.onopen = () => {
      console.log(`[Tab ${tabId}] WS Open`);
      
      // 1. Tell Content Script we are good
      try {
        port.postMessage({ type: 'STATUS', status: 'connected' });
        port.postMessage({ type: 'CONNECTED', roomId, userId });
      } catch (e) {
        console.error('Port dead', e);
      }

      // 2. Tell Popup we are good (Fixes "Stuck on Connecting")
      chrome.runtime.sendMessage({ type: 'STATUS', status: 'connected' }).catch(() => {});

      // Heartbeat Loop (Keep Alive)
      chrome.alarms.create(`heartbeat-${tabId}`, { periodInMinutes: 0.5 });
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        // Forward Server Message -> Content Script via Port
        // Check if port is still connected before posting
        try {
            port.postMessage(msg);
        } catch(e) {
            console.log('Port disconnected, cannot forward message');
        }
      } catch (e) {
        console.error('Parse error', e);
      }
    };

    socket.onclose = () => {
      console.log(`[Tab ${tabId}] WS Closed`);
      try {
        port.postMessage({ type: 'STATUS', status: 'disconnected' });
        chrome.runtime.sendMessage({ type: 'STATUS', status: 'disconnected' }).catch(() => {});
      } catch (e) {}
      sessions.delete(tabId);
      chrome.alarms.clear(`heartbeat-${tabId}`);
    };

    socket.onerror = (err) => {
      console.error(`[Tab ${tabId}] WS Error`);
      try {
        port.postMessage({ type: 'STATUS', status: 'error' });
        chrome.runtime.sendMessage({ type: 'STATUS', status: 'error' }).catch(() => {});
      } catch (e) {}
    };

  } catch (e) {
    console.error('Connection Exception', e);
    try {
        port.postMessage({ type: 'STATUS', status: 'error' });
        chrome.runtime.sendMessage({ type: 'STATUS', status: 'error' }).catch(() => {});
    } catch(err) {}
  }
}

function closeSession(tabId) {
  const session = sessions.get(tabId);
  if (session) {
    if (session.socket) {
        try {
            session.socket.close();
        } catch(e) {}
    }
    sessions.delete(tabId);
  }
  chrome.alarms.clear(`heartbeat-${tabId}`);
}

// Global Heartbeat Alarm (triggers for specific tabs)
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith('heartbeat-')) {
    const tabId = parseInt(alarm.name.split('-')[1]);
    const session = sessions.get(tabId);
    if (session && session.socket && session.socket.readyState === 1) { // 1 = OPEN
      session.socket.send(JSON.stringify({ type: 'heartbeat' }));
    }
  }
});

