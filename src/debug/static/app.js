// ============================================================================
// Hermes MQ Debug Dashboard - Real-time WebSocket Client
// ============================================================================

// State
const state = {
  activeView: 'overview',
  isPaused: false,
  messages: [],
  events: [],
  services: new Map(),
  stats: {
    total: 0,
    success: 0,
    error: 0,
    timeout: 0,
    avgLatency: 0,
    p95Latency: 0,
    p99Latency: 0
  },
  statusFilter: 'all',
  searchQuery: '',
  selectedMessage: null,
  sidebarCollapsed: false,
  ws: null,
  reconnectAttempts: 0,
  maxReconnectAttempts: 10,
  messageRate: [],
  latencyHistory: [],
  errorHistory: [],
  slowHistory: []
};

// ============================================================================
// WebSocket Connection
// ============================================================================

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  
  console.log('[Dashboard] Connecting to WebSocket:', wsUrl);
  updateConnectionStatus('connecting');
  
  state.ws = new WebSocket(wsUrl);
  
  state.ws.onopen = () => {
    console.log('[Dashboard] WebSocket connected');
    state.reconnectAttempts = 0;
    updateConnectionStatus('connected');
  };
  
  state.ws.onmessage = (event) => {
    if (state.isPaused) return;
    
    try {
      const message = JSON.parse(event.data);
      handleWebSocketMessage(message);
    } catch (error) {
      console.error('[Dashboard] Failed to parse message:', error);
    }
  };
  
  state.ws.onerror = (error) => {
    console.error('[Dashboard] WebSocket error:', error);
    updateConnectionStatus('disconnected');
  };
  
  state.ws.onclose = () => {
    console.log('[Dashboard] WebSocket closed');
    updateConnectionStatus('disconnected');
    
    // Auto-reconnect
    if (state.reconnectAttempts < state.maxReconnectAttempts) {
      state.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, state.reconnectAttempts), 30000);
      console.log(`[Dashboard] Reconnecting in ${delay}ms... (attempt ${state.reconnectAttempts})`);
      setTimeout(connectWebSocket, delay);
    }
  };
}

function updateConnectionStatus(status) {
  const badge = document.getElementById('connectionStatus');
  if (!badge) return;
  
  badge.className = 'status-badge ' + status;
  
  const statusText = {
    connecting: 'Connecting...',
    connected: 'Connected',
    disconnected: 'Disconnected'
  };
  
  badge.innerHTML = `
    <span class="status-dot"></span>
    <span>${statusText[status]}</span>
  `;
}

// ============================================================================
// Message Handlers
// ============================================================================

function handleWebSocketMessage(message) {
  switch (message.type) {
    case 'initial-data':
      handleInitialData(message.data);
      break;
    case 'message':
      handleNewMessage(message.data);
      break;
    case 'stats':
      handleStatsUpdate(message.data);
      break;
    case 'service-registered':
      handleServiceRegistered(message.data);
      break;
    case 'connection-health':
      handleConnectionHealth(message.data);
      break;
    case 'messages-cleared':
      handleMessagesCleared();
      break;
  }
}

function handleInitialData(data) {
  console.log('[Dashboard] Received initial data:', data);
  
  // Load messages
  if (data.messages && Array.isArray(data.messages)) {
    state.messages = data.messages.map(enrichMessage);
  }
  
  // Load services
  if (data.services && Array.isArray(data.services)) {
    data.services.forEach(service => {
      state.services.set(service.id, service);
    });
  }
  
  // Load stats
  if (data.stats) {
    state.stats = { ...state.stats, ...data.stats };
  }
  
  // Initial render
  renderAll();
}

function handleNewMessage(message) {
  const enriched = enrichMessage(message);
  state.messages.unshift(enriched);
  
  // Keep max 500 messages in UI
  if (state.messages.length > 500) {
    state.messages = state.messages.slice(0, 500);
  }
  
  // Update stats
  state.stats.total++;
  if (message.status === 'success') state.stats.success++;
  if (message.status === 'error') state.stats.error++;
  if (message.status === 'timeout') state.stats.timeout++;
  
  // Track for rate calculation
  state.messageRate.push(Date.now());
  state.messageRate = state.messageRate.filter(t => Date.now() - t < 60000); // Last minute
  
  // Track latency
  if (message.duration) {
    state.latencyHistory.push(message.duration);
    if (state.latencyHistory.length > 100) state.latencyHistory.shift();
    
    if (message.duration > 500) {
      state.slowHistory.push(1);
    } else {
      state.slowHistory.push(0);
    }
    if (state.slowHistory.length > 20) state.slowHistory.shift();
  }
  
  // Track errors
  if (message.status === 'error') {
    state.errorHistory.push(1);
  } else {
    state.errorHistory.push(0);
  }
  if (state.errorHistory.length > 20) state.errorHistory.shift();
  
  // Add to event stream
  addEvent({
    type: `message-${message.status}`,
    message: `${message.type} ${message.command} on ${message.queue} - ${message.duration}ms`
  });
  
  // Update UI
  if (!state.isPaused) {
    renderMessages('recent-messages', state.messages, 10);
    renderMessages('live-messages', state.messages);
    renderMessages('history-messages', state.messages);
    updateStats();
    updateCharts();
  }
}

function handleStatsUpdate(stats) {
  state.stats = { ...state.stats, ...stats };
  updateStats();
}

function handleServiceRegistered(service) {
  state.services.set(service.id, service);
  renderServices();
  
  addEvent({
    type: 'service-started',
    message: `Service ${service.name} (${service.type}) started`
  });
}

function handleConnectionHealth(health) {
  console.log('[Dashboard] Connection health:', health);
}

function handleMessagesCleared() {
  state.messages = [];
  state.events = [];
  renderAll();
}

// ============================================================================
// Data Enrichment
// ============================================================================

function enrichMessage(msg) {
  return {
    ...msg,
    time: new Date(msg.timestamp).toLocaleTimeString('en-US', { hour12: false }),
    displayType: msg.type.replace('-', ' ').toUpperCase()
  };
}

function addEvent(event) {
  state.events.unshift({
    ...event,
    id: Date.now() + Math.random(),
    time: new Date().toLocaleTimeString('en-US', { hour12: false })
  });
  
  if (state.events.length > 100) {
    state.events = state.events.slice(0, 100);
  }
  
  if (!state.isPaused && state.activeView === 'events') {
    renderEvents();
  }
}

// ============================================================================
// Rendering Functions
// ============================================================================

function renderAll() {
  renderServices();
  renderMessages('recent-messages', state.messages, 10);
  renderMessages('live-messages', state.messages);
  renderMessages('history-messages', state.messages);
  renderHandlers();
  renderEvents();
  updateStats();
  updateCharts();
}

function updateStats() {
  const total = state.stats.total || 0;
  const errorRate = total > 0 ? ((state.stats.error / total) * 100).toFixed(1) : 0;
  
  document.getElementById('stat-total').textContent = total.toLocaleString();
  document.getElementById('stat-errors').innerHTML = `${errorRate}<span class="stat-unit">%</span>`;
  document.getElementById('stat-services').textContent = state.services.size;
  
  // Calculate average latency
  if (state.latencyHistory.length > 0) {
    const avg = state.latencyHistory.reduce((a, b) => a + b, 0) / state.latencyHistory.length;
    document.getElementById('stat-latency').innerHTML = `${Math.round(avg)}<span class="stat-unit">ms</span>`;
  } else {
    document.getElementById('stat-latency').innerHTML = `-<span class="stat-unit">ms</span>`;
  }
}

function renderServices() {
  const container = document.getElementById('services-list-main');
  if (!container) return;
  
  const services = Array.from(state.services.values());
  
  if (services.length === 0) {
    container.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">No services connected</div>';
    return;
  }
  
  container.innerHTML = services.map(s => `
    <div class="service-card">
      <div class="service-status ${s.status === 'warning' ? 'warning' : ''}"></div>
      <div class="service-info">
        <div class="service-name">${s.name}</div>
        <div class="service-queue">${s.type}</div>
      </div>
      <div class="service-stats">${(s.messageCount || 0).toLocaleString()} msgs</div>
    </div>
  `).join('');
}

function renderMessageRow(msg, isNew = false) {
  const statusClass = msg.status || 'pending';
  return `
    <tr class="${isNew ? 'new-message' : ''}" data-id="${msg.id}" style="cursor: pointer;">
      <td class="mono">${msg.time}</td>
      <td><span class="badge badge-${msg.type}">${msg.displayType}</span></td>
      <td class="mono">${msg.command || '-'}</td>
      <td class="mono">${msg.queue || '-'}</td>
      <td class="mono">${msg.duration ? msg.duration + 'ms' : '-'}</td>
      <td><span class="badge badge-${statusClass}">${statusClass}</span></td>
    </tr>
  `;
}

function renderMessages(containerId, messages, limit = null) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  let filtered = messages;
  
  // Apply status filter
  if (state.statusFilter !== 'all') {
    filtered = filtered.filter(m => m.status === state.statusFilter);
  }
  
  // Apply search filter
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    filtered = filtered.filter(m => 
      (m.command && m.command.toLowerCase().includes(q)) || 
      (m.queue && m.queue.toLowerCase().includes(q))
    );
  }
  
  // Apply limit
  if (limit) {
    filtered = filtered.slice(0, limit);
  }
  
  if (filtered.length === 0) {
    container.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px; color: #666;">No messages yet</td></tr>';
    return;
  }
  
  const isLive = containerId === 'live-messages';
  container.innerHTML = filtered.map((m, i) => renderMessageRow(m, isLive && i === 0)).join('');
  
  // Add click handlers
  container.querySelectorAll('tr[data-id]').forEach(row => {
    row.addEventListener('click', () => {
      const msg = messages.find(m => m.id === row.dataset.id);
      if (msg) showMessageDetails(msg);
    });
  });
}

function renderHandlers() {
  const container = document.getElementById('handlers-list');
  if (!container) return;
  
  // Get handler performance from messages
  const handlers = {};
  state.messages.forEach(msg => {
    if (msg.command) {
      if (!handlers[msg.command]) {
        handlers[msg.command] = { name: msg.command, calls: 0, totalTime: 0, errors: 0 };
      }
      handlers[msg.command].calls++;
      if (msg.duration) handlers[msg.command].totalTime += msg.duration;
      if (msg.status === 'error') handlers[msg.command].errors++;
    }
  });
  
  const handlerList = Object.values(handlers);
  
  if (handlerList.length === 0) {
    container.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">No handler data available</div>';
    return;
  }
  
  container.innerHTML = handlerList.map(h => {
    const avgTime = h.calls > 0 ? Math.round(h.totalTime / h.calls) : 0;
    const successRate = h.calls > 0 ? (((h.calls - h.errors) / h.calls) * 100).toFixed(1) : 100;
    
    return `
      <div class="handler-card">
        <div class="handler-header">
          <span class="handler-name">${h.name}</span>
          <span class="badge badge-${successRate >= 99 ? 'success' : successRate >= 95 ? 'timeout' : 'error'}">
            ${successRate}% success
          </span>
        </div>
        <div class="handler-stats">
          <div class="handler-stat">
            <div class="handler-stat-value">${h.calls.toLocaleString()}</div>
            <div class="handler-stat-label">Calls</div>
          </div>
          <div class="handler-stat">
            <div class="handler-stat-value">${avgTime}ms</div>
            <div class="handler-stat-label">Avg Time</div>
          </div>
          <div class="handler-stat">
            <div class="handler-stat-value" style="color: var(--accent-red)">${h.errors}</div>
            <div class="handler-stat-label">Errors</div>
          </div>
          <div class="handler-stat">
            <div class="handler-stat-value" style="color: var(--accent-green)">${successRate}%</div>
            <div class="handler-stat-label">Success</div>
          </div>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${successRate}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

function renderEvents() {
  const container = document.getElementById('event-stream');
  if (!container) return;
  
  if (state.events.length === 0) {
    container.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">No events yet</div>';
    return;
  }
  
  container.innerHTML = state.events.slice(0, 50).map(e => `
    <div class="event-item">
      <span class="event-time">${e.time}</span>
      <span class="event-type ${e.type}">${e.type.replace(/-/g, ' ').toUpperCase()}</span>
      <span class="event-message">${e.message}</span>
    </div>
  `).join('');
}

function showMessageDetails(msg) {
  state.selectedMessage = msg;
  const panel = document.getElementById('message-details');
  const content = document.getElementById('details-content');
  const overlay = document.getElementById('overlay');
  
  content.innerHTML = `
    <div class="details-section">
      <div class="details-label">Message ID</div>
      <div class="details-value mono">${msg.id}</div>
    </div>
    <div class="details-section">
      <div class="details-label">Type</div>
      <div class="details-value"><span class="badge badge-${msg.type}">${msg.displayType}</span></div>
    </div>
    <div class="details-section">
      <div class="details-label">Command</div>
      <div class="details-value mono">${msg.command || '-'}</div>
    </div>
    <div class="details-section">
      <div class="details-label">Queue</div>
      <div class="details-value mono">${msg.queue || '-'}</div>
    </div>
    <div class="details-section">
      <div class="details-label">Status</div>
      <div class="details-value"><span class="badge badge-${msg.status}">${msg.status}</span></div>
    </div>
    <div class="details-section">
      <div class="details-label">Duration</div>
      <div class="details-value mono">${msg.duration ? msg.duration + 'ms' : '-'}</div>
    </div>
    <div class="details-section">
      <div class="details-label">Timestamp</div>
      <div class="details-value mono">${new Date(msg.timestamp).toISOString()}</div>
    </div>
    ${msg.correlationId ? `
      <div class="details-section">
        <div class="details-label">Correlation ID</div>
        <div class="details-value mono">${msg.correlationId}</div>
      </div>
    ` : ''}
    ${msg.payload ? `
      <div class="details-section">
        <div class="details-label">Payload</div>
        <div class="code-block">${JSON.stringify(msg.payload, null, 2)}</div>
      </div>
    ` : ''}
    ${msg.response ? `
      <div class="details-section">
        <div class="details-label">Response</div>
        <div class="code-block">${JSON.stringify(msg.response, null, 2)}</div>
      </div>
    ` : ''}
    ${msg.error ? `
      <div class="details-section">
        <div class="details-label">Error</div>
        <div class="code-block error-trace">${typeof msg.error === 'string' ? msg.error : JSON.stringify(msg.error, null, 2)}</div>
      </div>
    ` : ''}
    ${msg.metadata ? `
      <div class="details-section">
        <div class="details-label">Metadata</div>
        <div class="code-block">${JSON.stringify(msg.metadata, null, 2)}</div>
      </div>
    ` : ''}
  `;
  
  panel.classList.add('open');
  overlay.classList.add('active');
}

function closeDetails() {
  document.getElementById('message-details').classList.remove('open');
  document.getElementById('overlay').classList.remove('active');
  state.selectedMessage = null;
}

// ============================================================================
// Chart Drawing
// ============================================================================

function drawAreaChart(canvasId, data, color, gradient = true) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * 2;
  canvas.height = rect.height * 2;
  ctx.scale(2, 2);
  
  const width = rect.width;
  const height = rect.height;
  const padding = 30;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding;
  
  ctx.clearRect(0, 0, width, height);
  
  if (data.length === 0) {
    ctx.fillStyle = '#666';
    ctx.font = '12px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No data', width / 2, height / 2);
    return;
  }
  
  const max = Math.max(...data, 1) * 1.2;
  const min = 0;
  const range = max - min;
  
  // Draw grid
  ctx.strokeStyle = '#1e1e1e';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padding + (chartHeight / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
    ctx.stroke();
  }
  
  // Draw axis labels
  ctx.fillStyle = '#555';
  ctx.font = '10px -apple-system, sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const value = Math.round(max - (range / 4) * i);
    const y = padding + (chartHeight / 4) * i;
    ctx.fillText(value.toString(), padding - 5, y + 3);
  }
  
  // Draw area
  const points = data.map((value, i) => ({
    x: padding + (chartWidth / (data.length - 1)) * i,
    y: padding + chartHeight - ((value - min) / range) * chartHeight
  }));
  
  if (gradient) {
    const grad = ctx.createLinearGradient(0, padding, 0, height);
    grad.addColorStop(0, color + '40');
    grad.addColorStop(1, color + '00');
    
    ctx.beginPath();
    ctx.moveTo(points[0].x, height - padding);
    points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length - 1].x, height - padding);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
  }
  
  // Draw line
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  points.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  
  // Draw points
  points.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  });
}

function drawBarChart(canvasId, errorsData, slowData) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * 2;
  canvas.height = rect.height * 2;
  ctx.scale(2, 2);
  
  const width = rect.width;
  const height = rect.height;
  const padding = 30;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding;
  
  ctx.clearRect(0, 0, width, height);
  
  if (errorsData.length === 0) {
    ctx.fillStyle = '#666';
    ctx.font = '12px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No data', width / 2, height / 2);
    return;
  }
  
  const allData = [...errorsData, ...slowData];
  const max = Math.max(...allData, 1) * 1.2;
  
  // Draw grid
  ctx.strokeStyle = '#1e1e1e';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padding + (chartHeight / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
    ctx.stroke();
  }
  
  // Draw bars
  const barWidth = (chartWidth / errorsData.length) * 0.35;
  const gap = (chartWidth / errorsData.length) * 0.1;
  
  errorsData.forEach((value, i) => {
    const x = padding + (chartWidth / errorsData.length) * i + gap;
    const barHeight = (value / max) * chartHeight;
    
    ctx.fillStyle = '#ff6b6b';
    ctx.fillRect(x, padding + chartHeight - barHeight, barWidth, barHeight);
  });
  
  slowData.forEach((value, i) => {
    const x = padding + (chartWidth / slowData.length) * i + gap + barWidth + 2;
    const barHeight = (value / max) * chartHeight;
    
    ctx.fillStyle = '#ffc107';
    ctx.fillRect(x, padding + chartHeight - barHeight, barWidth, barHeight);
  });
  
  // Legend
  ctx.fillStyle = '#ff6b6b';
  ctx.fillRect(width - 100, 10, 10, 10);
  ctx.fillStyle = '#888';
  ctx.font = '10px -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Errors', width - 85, 18);
  
  ctx.fillStyle = '#ffc107';
  ctx.fillRect(width - 100, 25, 10, 10);
  ctx.fillStyle = '#888';
  ctx.fillText('Slow', width - 85, 33);
}

function updateCharts() {
  // Calculate message rate
  const now = Date.now();
  const recentMessages = state.messageRate.filter(t => now - t < 1000);
  const msgPerSec = recentMessages.length;
  
  // Update throughput chart data
  state.latencyHistory.push(state.stats.avgLatency || 0);
  if (state.latencyHistory.length > 20) state.latencyHistory.shift();
  
  // Draw charts
  drawAreaChart('chart-latency', state.latencyHistory.slice(-20), '#00a8ff');
  drawAreaChart('chart-throughput', Array(20).fill(msgPerSec), '#00d68f');
  drawBarChart('chart-errors', state.errorHistory.slice(-20), state.slowHistory.slice(-20));
}

// ============================================================================
// Navigation & UI Controls
// ============================================================================

function setView(view) {
  state.activeView = view;
  
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === view);
  });
  
  document.querySelectorAll('.view').forEach(v => {
    v.classList.toggle('active', v.id === 'view-' + view);
  });
  
  const titles = {
    overview: 'Overview',
    live: 'Live Messages',
    history: 'Message History',
    handlers: 'Handler Performance',
    events: 'Event Stream',
    services: 'Connected Services'
  };
  document.getElementById('headerTitle').textContent = titles[view];
  
  if (view === 'overview') {
    setTimeout(updateCharts, 50);
  }
}

// ============================================================================
// Event Listeners
// ============================================================================

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => setView(item.dataset.view));
});

document.getElementById('collapseBtn').addEventListener('click', () => {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  document.getElementById('sidebar').classList.toggle('collapsed');
});

document.getElementById('pauseBtn').addEventListener('click', function() {
  state.isPaused = !state.isPaused;
  this.innerHTML = state.isPaused ? `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
    Resume
  ` : `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
    </svg>
    Pause
  `;
});

document.getElementById('close-details').addEventListener('click', closeDetails);
document.getElementById('overlay').addEventListener('click', closeDetails);

document.querySelectorAll('#status-filter .filter-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    document.querySelectorAll('#status-filter .filter-btn').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    state.statusFilter = this.dataset.status;
    renderMessages('live-messages', state.messages);
  });
});

document.getElementById('message-search').addEventListener('input', function() {
  state.searchQuery = this.value;
  renderMessages('live-messages', state.messages);
});

document.getElementById('export-btn').addEventListener('click', () => {
  const data = JSON.stringify(state.messages, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'hermes-messages-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('clear-btn').addEventListener('click', () => {
  if (confirm('Clear all message history?')) {
    // Send clear request to server
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: 'clear-messages' }));
    }
    state.messages = [];
    state.events = [];
    renderAll();
  }
});

// ============================================================================
// Initialization
// ============================================================================

// Connect to WebSocket
connectWebSocket();

// Update charts periodically
setInterval(() => {
  if (!state.isPaused && state.activeView === 'overview') {
    updateCharts();
  }
}, 3000);

// Handle window resize
window.addEventListener('resize', () => {
  if (state.activeView === 'overview') {
    updateCharts();
  }
});

console.log('[Dashboard] Initialized');
