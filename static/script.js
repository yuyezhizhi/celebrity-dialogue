let ws = null;
let philosophers = [];
let selectedPhilosophers = [];
let isRunning = false;
let editingPhilosopherId = null;
let typingTimerInterval = null;
let typingStartTime = 0;
let currentTopic = '';
let currentMaxRounds = 8;
let dialogueMessages = [];

document.addEventListener('DOMContentLoaded', async () => {
    await loadPhilosophers();
    bindEvents();
    restoreDialogue();
});

async function loadPhilosophers() {
    try {
        const resp = await fetch('/api/philosophers');
        philosophers = await resp.json();
        renderPhilosopherList();
    } catch (e) {
        console.error('加载名人列表失败', e);
    }
}

function renderPhilosopherList() {
    const container = document.getElementById('philosopher-list');
    container.innerHTML = philosophers.map((p, idx) => {
        const order = selectedPhilosophers.indexOf(p.id);
        const selected = order >= 0;
        return `
            <div class="philosopher-card ${selected ? 'selected' : ''}"
                 data-id="${p.id}"
                 onclick="togglePhilosopher('${p.id}')">
                <div class="order-badge">${selected ? order + 1 : ''}</div>
                <div class="avatar" onclick="event.stopPropagation(); openConfigModal('${p.id}')" title="点击配置模型">${p.avatar}</div>
                <div class="name">${p.name}</div>
                <div class="school">${p.school}</div>
            </div>
        `;
    }).join('');

    // 更新按钮状态
    updateStartButton();
}

function togglePhilosopher(id) {
    if (isRunning) return;

    const idx = selectedPhilosophers.indexOf(id);
    if (idx >= 0) {
        selectedPhilosophers.splice(idx, 1);
    } else {
        selectedPhilosophers.push(id);
    }
    renderPhilosopherList();
}

function bindEvents() {
    document.getElementById('start-btn').addEventListener('click', startDialogue);
    document.getElementById('stop-btn').addEventListener('click', stopDialogue);
    document.getElementById('clear-btn').addEventListener('click', clearDialogue);

    document.getElementById('modal-cancel').addEventListener('click', closeConfigModal);
    document.getElementById('modal-save').addEventListener('click', savePhilosopherConfig);

    document.getElementById('config-modal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeConfigModal();
    });
}

function openConfigModal(philosopherId) {
    const p = philosophers.find(ph => ph.id === philosopherId);
    if (!p) return;

    editingPhilosopherId = philosopherId;
    document.getElementById('modal-title').textContent = `配置 ${p.name}`;
    document.getElementById('modal-model').value = p.model || 'gpt-3.5-turbo';
    document.getElementById('modal-apikey').value = p.api_key || '';
    document.getElementById('modal-baseurl').value = p.base_url || 'https://api.openai.com/v1';
    document.getElementById('modal-thinking-time').value = p.thinking_time || 3;
    document.getElementById('modal-temperature').value = p.temperature || 0.8;
    document.getElementById('modal-maxtokens').value = p.max_tokens || 400;
    document.getElementById('modal-prompt').value = p.system_prompt || '';

    document.getElementById('config-modal').classList.add('active');
}

function closeConfigModal() {
    document.getElementById('config-modal').classList.remove('active');
    editingPhilosopherId = null;
}

function savePhilosopherConfig() {
    const p = philosophers.find(ph => ph.id === editingPhilosopherId);
    if (!p) return;

    p.model = document.getElementById('modal-model').value;
    p.api_key = document.getElementById('modal-apikey').value;
    p.base_url = document.getElementById('modal-baseurl').value;
    p.thinking_time = parseInt(document.getElementById('modal-thinking-time').value) || 3;
    p.temperature = parseFloat(document.getElementById('modal-temperature').value) || 0.8;
    p.max_tokens = parseInt(document.getElementById('modal-maxtokens').value) || 400;
    p.system_prompt = document.getElementById('modal-prompt').value;

    renderPhilosopherList();
    closeConfigModal();
}

function startDialogue() {
    const topic = document.getElementById('topic').value.trim();
    if (!topic) {
        alert('请输入讨论主题');
        return;
    }

    if (selectedPhilosophers.length < 2) {
        alert('请至少选择两位名人参与讨论');
        return;
    }

    const maxRounds = parseInt(document.getElementById('max-rounds').value) || 8;

    currentTopic = topic;
    currentMaxRounds = maxRounds;

    const activePhilosophers = selectedPhilosophers.map(id =>
        philosophers.find(p => p.id === id)
    ).filter(Boolean);

    clearPreviousDialogue();

    document.getElementById('dialogue-topic').style.display = 'block';
    document.getElementById('topic-display').textContent = topic;

    initProgressBar();
    setRunning(true);

    dialogueMessages = [];
    saveDialogue();

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws/dialogue`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        ws.send(JSON.stringify({
            topic: topic,
            philosophers: activePhilosophers,
            max_rounds: maxRounds,
        }));
    };

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        if (msg.type === 'typing') {
            showTyping(msg.data.philosopher_name, msg.data.current_round, msg.data.max_rounds, msg.data.philosopher_index, msg.data.total_philosophers, msg.data.philosopher_id);
        } else if (msg.type === 'message') {
            hideTyping();
            appendMessage(msg.data);
            dialogueMessages.push(msg.data);
            saveDialogue();
        } else if (msg.type === 'done') {
            hideTyping();
            setRunning(false);
            updateProgress(1, 1);
            const statusEl = document.getElementById('dialogue-status');
            statusEl.textContent = `对话结束 - 共 ${msg.data.total_messages} 条发言, ${msg.data.total_rounds} 轮讨论`;
            statusEl.className = 'status-bar completed';
            showExportButton();
            showToast(`讨论结束，共 ${msg.data.total_rounds} 轮 ${msg.data.total_messages} 条发言`);
            dialogueMessages = [];
            saveDialogue();
        } else if (msg.type === 'error') {
            hideTyping();
            setRunning(false);
            document.getElementById('dialogue-status').textContent = '错误: ' + msg.data.message;
        }
    };

    ws.onerror = () => {
        hideTyping();
        setRunning(false);
        document.getElementById('dialogue-status').textContent = '连接出错，请重试';
    };

    ws.onclose = () => {
        hideTyping();
        setRunning(false);
    };
}

function clearPreviousDialogue() {
    hideTyping();
    hideExportButton();
    document.getElementById('dialogue-messages').innerHTML = '';
    document.getElementById('dialogue-status').textContent = '';
    document.getElementById('dialogue-status').className = 'status-bar';
    document.getElementById('dialogue-topic').style.display = 'none';
}

function clearDialogue() {
    clearPreviousDialogue();
    dialogueMessages = [];
    saveDialogue();
}

function initProgressBar() {
    let bar = document.getElementById('progress-bar');
    if (!bar) {
        const wrap = document.createElement('div');
        wrap.className = 'progress-bar-wrap';
        wrap.id = 'progress-bar-wrap';
        wrap.innerHTML = '<div class="progress-bar-fill" id="progress-bar"></div>';
        const msgs = document.getElementById('dialogue-messages');
        msgs.parentNode.insertBefore(wrap, msgs);
    } else {
        bar.style.width = '0%';
    }
}

function updateProgress(current, total) {
    const bar = document.getElementById('progress-bar');
    if (bar) {
        bar.style.width = Math.round((current / total) * 100) + '%';
    }
}

function showTyping(name, currentRound, maxRounds, philosopherIndex, totalPhilosophers, philosopherId) {
    hideTyping();
    updateProgress(currentRound - 1 + philosopherIndex / totalPhilosophers, maxRounds);

    typingStartTime = Date.now();
    typingTimerInterval = setInterval(updateTypingTimer, 200);

    const roundInfo = `第 ${currentRound}/${maxRounds} 轮`;
    const container = document.getElementById('dialogue-messages');
    const el = document.createElement('div');
    el.className = 'typing-indicator';
    el.id = 'typing-indicator';
    el.innerHTML = `
        <div class="typing-dots"><span></span><span></span><span></span></div>
        <span>${name} 正在思考...</span>
        <span class="typing-timer" id="typing-timer">0s</span>
        <span style="font-size:0.7rem;color:#6a5a4a;margin-left:8px;">${roundInfo}</span>
    `;
    container.appendChild(el);
    el.scrollIntoView({ behavior: 'smooth', block: 'end' });
    showThinkOverlay(name, philosopherId);
}

function updateTypingTimer() {
    const timer = document.getElementById('typing-timer');
    if (timer) {
        const elapsed = Math.floor((Date.now() - typingStartTime) / 1000);
        timer.textContent = elapsed + 's';
    }
}

function hideTyping() {
    if (typingTimerInterval) {
        clearInterval(typingTimerInterval);
        typingTimerInterval = null;
    }
    const el = document.getElementById('typing-indicator');
    if (el) el.remove();
    hideThinkOverlay();
}

function showThinkOverlay(name, philosopherId) {
    hideThinkOverlay();
    const overlay = document.getElementById('think-overlay') || createThinkOverlay();
    overlay.className = `think-overlay think-${philosopherId} active`;

    generateParticles(overlay, philosopherId);

    const label = overlay.querySelector('.think-label');
    if (label) {
        label.innerHTML = `${name} <span style="font-size:0.8rem;">沉思中</span> <span class="dots">...</span>`;
    }
}

function createThinkOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'think-overlay';
    overlay.className = 'think-overlay';
    const label = document.createElement('div');
    label.className = 'think-label';
    overlay.appendChild(label);
    document.body.appendChild(overlay);
    return overlay;
}

function hideThinkOverlay() {
    const overlay = document.getElementById('think-overlay');
    if (overlay) {
        overlay.classList.remove('active');
        overlay.innerHTML = '<div class="think-label"></div>';
    }
}

function generateParticles(overlay, philosopherId) {
    const count = 20;

    if (philosopherId === 'socrates') {
        for (let i = 0; i < count; i++) {
            const p = document.createElement('div');
            p.className = 'particle';
            p.textContent = '?';
            p.style.left = Math.random() * 90 + '%';
            p.style.animationDelay = Math.random() * 4 + 's';
            p.style.animationDuration = (3 + Math.random() * 5) + 's';
            p.style.fontSize = (1 + Math.random() * 2.5) + 'rem';
            overlay.appendChild(p);
        }
    } else if (philosopherId === 'nietzsche') {
        for (let i = 0; i < 12; i++) {
            const c = document.createElement('div');
            c.className = 'crack';
            c.style.left = (10 + Math.random() * 80) + '%';
            c.style.top = '0';
            c.style.height = (60 + Math.random() * 40) + '%';
            c.style.animationDelay = Math.random() * 3 + 's';
            c.style.animationDuration = (1.5 + Math.random() * 2) + 's';
            c.style.transform = `rotate(${-20 + Math.random() * 40}deg)`;
            overlay.appendChild(c);
        }
    } else if (philosopherId === 'zhuangzi') {
        const butterflies = ['&#x1f98b;', '&#x1f98b;'];
        for (let i = 0; i < 8; i++) {
            const b = document.createElement('div');
            b.className = 'butterfly';
            b.innerHTML = butterflies[i % 2];
            b.style.animationDelay = Math.random() * 6 + 's';
            b.style.animationDuration = (4 + Math.random() * 8) + 's';
            overlay.appendChild(b);
        }
    } else if (philosopherId === 'kant') {
        for (let i = 0; i < 8; i++) {
            const g = document.createElement('div');
            g.className = 'geo-line';
            g.style.left = (10 + Math.random() * 80) + '%';
            g.style.top = (10 + Math.random() * 80) + '%';
            g.style.width = (60 + Math.random() * 100) + 'px';
            g.style.height = (60 + Math.random() * 100) + 'px';
            g.style.animationDelay = Math.random() * 4 + 's';
            g.style.animationDuration = (3 + Math.random() * 3) + 's';
            overlay.appendChild(g);
        }
    } else if (philosopherId === 'confucius') {
        for (let i = 0; i < 6; i++) {
            const r = document.createElement('div');
            r.className = 'ripple';
            r.style.left = (20 + Math.random() * 60) + '%';
            r.style.top = (20 + Math.random() * 60) + '%';
            r.style.animationDelay = Math.random() * 4 + 's';
            r.style.animationDuration = (3 + Math.random() * 4) + 's';
            overlay.appendChild(r);
        }
    } else if (philosopherId === 'sartre') {
        for (let i = 0; i < 10; i++) {
            const s = document.createElement('div');
            s.className = 'smoke';
            s.style.left = (30 + Math.random() * 40) + '%';
            s.style.bottom = '10%';
            s.style.animationDelay = Math.random() * 5 + 's';
            s.style.animationDuration = (4 + Math.random() * 4) + 's';
            overlay.appendChild(s);
        }
    } else if (philosopherId === 'aristotle') {
        for (let i = 0; i < 12; i++) {
            const sq = document.createElement('div');
            sq.className = 'square';
            sq.style.left = (5 + Math.random() * 90) + '%';
            sq.style.top = (5 + Math.random() * 90) + '%';
            sq.style.animationDelay = Math.random() * 5 + 's';
            sq.style.animationDuration = (3 + Math.random() * 4) + 's';
            overlay.appendChild(sq);
        }
    } else if (philosopherId === 'descartes') {
        for (let i = 0; i < 6; i++) {
            const g = document.createElement('div');
            g.className = 'grid-line';
            g.style.left = '0';
            g.style.top = (10 + i * 15) + '%';
            g.style.width = '100%';
            g.style.height = '1px';
            g.style.animationDelay = Math.random() * 3 + 's';
            g.style.animationDuration = (2 + Math.random() * 3) + 's';
            overlay.appendChild(g);
        }
        for (let i = 0; i < 6; i++) {
            const g = document.createElement('div');
            g.className = 'grid-line';
            g.style.top = '0';
            g.style.left = (10 + i * 15) + '%';
            g.style.width = '1px';
            g.style.height = '100%';
            g.style.animationDelay = Math.random() * 3 + 's';
            g.style.animationDuration = (2 + Math.random() * 3) + 's';
            overlay.appendChild(g);
        }
    } else if (philosopherId === 'rousseau') {
        for (let i = 0; i < 10; i++) {
            const v = document.createElement('div');
            v.className = 'vine';
            v.style.left = (5 + Math.random() * 90) + '%';
            v.style.bottom = '0';
            v.style.height = (40 + Math.random() * 50) + '%';
            v.style.animationDelay = Math.random() * 5 + 's';
            v.style.animationDuration = (3 + Math.random() * 4) + 's';
            overlay.appendChild(v);
        }
    } else if (philosopherId === 'wangyangming') {
        const h = document.createElement('div');
        h.className = 'heart-glow';
        h.style.left = '50%';
        h.style.top = '50%';
        h.style.transform = 'translate(-50%, -50%)';
        overlay.appendChild(h);
        for (let i = 0; i < 5; i++) {
            const r = document.createElement('div');
            r.className = 'ripple';
            r.style.left = '50%';
            r.style.top = '50%';
            r.style.transform = 'translate(-50%, -50%)';
            r.style.animationDelay = (i * 0.8) + 's';
            r.style.animationDuration = '4s';
            overlay.appendChild(r);
        }
    } else if (philosopherId === 'schopenhauer') {
        for (let i = 0; i < 8; i++) {
            const v = document.createElement('div');
            v.className = 'vortex';
            v.style.left = '50%';
            v.style.top = '50%';
            v.style.transform = 'translate(-50%, -50%)';
            v.style.marginLeft = (-40 + Math.random() * 80) + 'px';
            v.style.marginTop = (-40 + Math.random() * 80) + 'px';
            v.style.animationDelay = Math.random() * 3 + 's';
            v.style.animationDuration = (3 + Math.random() * 3) + 's';
            overlay.appendChild(v);
        }
    } else if (philosopherId === 'foucault') {
        for (let i = 0; i < 30; i++) {
            const e = document.createElement('div');
            e.className = 'watch-eye';
            e.style.left = (5 + Math.random() * 90) + '%';
            e.style.top = (5 + Math.random() * 90) + '%';
            e.style.animationDelay = Math.random() * 4 + 's';
            e.style.animationDuration = (2 + Math.random() * 3) + 's';
            overlay.appendChild(e);
        }
    } else if (philosopherId === 'plato') {
        for (let i = 0; i < 8; i++) {
            const b = document.createElement('div');
            b.className = 'beam';
            b.style.left = (5 + Math.random() * 90) + '%';
            b.style.animationDelay = Math.random() * 5 + 's';
            b.style.animationDuration = (3 + Math.random() * 4) + 's';
            overlay.appendChild(b);
        }
    } else if (philosopherId === 'laozi') {
        for (let i = 0; i < 6; i++) {
            const c = document.createElement('div');
            c.className = 'cloud';
            c.style.top = (10 + i * 15) + '%';
            c.style.animationDelay = Math.random() * 6 + 's';
            c.style.animationDuration = (6 + Math.random() * 6) + 's';
            overlay.appendChild(c);
        }
    } else if (philosopherId === 'marx') {
        for (let i = 0; i < 8; i++) {
            const g = document.createElement('div');
            g.className = 'gear';
            g.style.left = (10 + Math.random() * 80) + '%';
            g.style.top = (10 + Math.random() * 80) + '%';
            g.style.animationDelay = Math.random() * 4 + 's';
            g.style.animationDuration = (3 + Math.random() * 4) + 's';
            overlay.appendChild(g);
        }
    } else if (philosopherId === 'smith') {
        for (let i = 0; i < 10; i++) {
            const a = document.createElement('div');
            a.className = 'arrow';
            a.style.left = (10 + Math.random() * 80) + '%';
            a.style.bottom = '0';
            a.style.animationDelay = Math.random() * 4 + 's';
            a.style.animationDuration = (3 + Math.random() * 4) + 's';
            overlay.appendChild(a);
        }
    } else if (philosopherId === 'debeauvoir') {
        for (let i = 0; i < 6; i++) {
            const ch = document.createElement('div');
            ch.className = 'chain';
            ch.style.left = (20 + Math.random() * 60) + '%';
            ch.style.top = (20 + i * 12) + '%';
            ch.style.animationDelay = Math.random() * 3 + 's';
            ch.style.animationDuration = (3 + Math.random() * 3) + 's';
            overlay.appendChild(ch);
        }
    } else if (philosopherId === 'einstein') {
        for (let i = 0; i < 12; i++) {
            const o = document.createElement('div');
            o.className = 'orbit';
            o.style.left = (10 + Math.random() * 80) + '%';
            o.style.top = (10 + Math.random() * 80) + '%';
            o.style.animationDelay = Math.random() * 4 + 's';
            o.style.animationDuration = (4 + Math.random() * 4) + 's';
            overlay.appendChild(o);
        }
    } else if (philosopherId === 'buddha') {
        for (let i = 0; i < 10; i++) {
            const p = document.createElement('div');
            p.className = 'petal';
            p.style.left = (10 + Math.random() * 80) + '%';
            p.style.top = '-' + (10 + Math.random() * 20) + 'vh';
            p.style.animationDelay = Math.random() * 6 + 's';
            p.style.animationDuration = (4 + Math.random() * 6) + 's';
            overlay.appendChild(p);
        }
    } else if (philosopherId === 'machiavelli') {
        for (let i = 0; i < 8; i++) {
            const p = document.createElement('div');
            p.className = 'piece';
            p.style.left = (10 + Math.random() * 80) + '%';
            p.style.top = '-' + (5 + Math.random() * 20) + 'vh';
            p.style.animationDelay = Math.random() * 4 + 's';
            p.style.animationDuration = (3 + Math.random() * 3) + 's';
            overlay.appendChild(p);
        }
    } else if (philosopherId === 'freud') {
        for (let i = 0; i < 10; i++) {
            const b = document.createElement('div');
            b.className = 'blot';
            b.style.left = (10 + Math.random() * 80) + '%';
            b.style.top = (10 + Math.random() * 80) + '%';
            b.style.animationDelay = Math.random() * 5 + 's';
            b.style.animationDuration = (4 + Math.random() * 4) + 's';
            overlay.appendChild(b);
        }
    } else if (philosopherId === 'arendt') {
        for (let i = 0; i < 12; i++) {
            const f = document.createElement('div');
            f.className = 'flame';
            f.style.left = (10 + Math.random() * 80) + '%';
            f.style.top = (10 + Math.random() * 80) + '%';
            f.style.animationDelay = Math.random() * 3 + 's';
            f.style.animationDuration = (2 + Math.random() * 3) + 's';
            overlay.appendChild(f);
        }
    } else if (philosopherId === 'mozi') {
        for (let i = 0; i < 6; i++) {
            const s = document.createElement('div');
            s.className = 'shield';
            s.style.left = (10 + Math.random() * 80) + '%';
            s.style.top = (10 + Math.random() * 80) + '%';
            s.style.animationDelay = Math.random() * 4 + 's';
            s.style.animationDuration = (3 + Math.random() * 4) + 's';
            overlay.appendChild(s);
        }
    } else if (philosopherId === 'voltaire') {
        for (let i = 0; i < 8; i++) {
            const q = document.createElement('div');
            q.className = 'quill';
            q.innerHTML = '&#x270d;';
            q.style.left = (10 + Math.random() * 80) + '%';
            q.style.top = (10 + Math.random() * 80) + '%';
            q.style.animationDelay = Math.random() * 4 + 's';
            q.style.animationDuration = (4 + Math.random() * 4) + 's';
            overlay.appendChild(q);
        }
    } else if (philosopherId === 'darwin') {
        for (let i = 0; i < 8; i++) {
            const b = document.createElement('div');
            b.className = 'branch';
            b.style.left = (10 + Math.random() * 80) + '%';
            b.style.top = (10 + Math.random() * 80) + '%';
            b.style.transform = `rotate(${-60 + Math.random() * 60}deg)`;
            b.style.animationDelay = Math.random() * 5 + 's';
            b.style.animationDuration = (3 + Math.random() * 4) + 's';
            overlay.appendChild(b);
        }
    } else if (philosopherId === 'suntzu') {
        for (let i = 0; i < 12; i++) {
            const s = document.createElement('div');
            s.className = 'soldier';
            s.style.left = '5%';
            s.style.top = (5 + i * 8) + '%';
            s.style.animationDelay = (i * 0.3) + 's';
            s.style.animationDuration = '2s';
            overlay.appendChild(s);
        }
    } else if (philosopherId === 'wittgenstein') {
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ&|~^?!';
        for (let i = 0; i < 15; i++) {
            const l = document.createElement('div');
            l.className = 'letter';
            l.textContent = letters[Math.floor(Math.random() * letters.length)];
            l.style.left = (5 + Math.random() * 90) + '%';
            l.style.fontSize = (1 + Math.random() * 2) + 'rem';
            l.style.animationDelay = Math.random() * 5 + 's';
            l.style.animationDuration = (4 + Math.random() * 6) + 's';
            overlay.appendChild(l);
        }
    } else if (philosopherId === 'turing') {
        for (let i = 0; i < 15; i++) {
            const b = document.createElement('div');
            b.className = 'binary';
            b.textContent = Math.random() > 0.5 ? '0' : '1';
            b.style.left = (5 + Math.random() * 90) + '%';
            b.style.animationDelay = Math.random() * 3 + 's';
            b.style.animationDuration = (2 + Math.random() * 3) + 's';
            overlay.appendChild(b);
        }
    } else {
        for (let i = 0; i < 15; i++) {
            const p = document.createElement('div');
            p.className = 'particle';
            p.textContent = '?';
            p.style.left = Math.random() * 90 + '%';
            p.style.animationDelay = Math.random() * 4 + 's';
            p.style.animationDuration = (3 + Math.random() * 5) + 's';
            p.style.fontSize = (1 + Math.random() * 2) + 'rem';
            overlay.appendChild(p);
        }
    }
}

function appendMessage(msg) {
    const container = document.getElementById('dialogue-messages');
    const p = philosophers.find(ph => ph.id === msg.philosopher_id);
    const sourceLabel = msg.source === 'simulation' ? '<span class="source-badge simulation">模拟回复</span>' : '';
    const card = document.createElement('div');
    card.className = 'message-card';
    card.innerHTML = `
        <div class="message-avatar" ${p ? `style="cursor:pointer" title="点击配置" onclick="openConfigModal('${p.id}')"` : ''}>
            ${p ? p.avatar : '&#x1f4ac;'}
        </div>
        <div class="message-body">
            <div class="message-header">
                <span class="message-name">${msg.philosopher_name}</span>
                ${sourceLabel}
                <span class="message-round">第 ${msg.round_number} 轮</span>
            </div>
            <div class="message-content">${msg.content}</div>
        </div>
    `;

    container.appendChild(card);
    card.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function stopDialogue() {
    if (ws) {
        ws.close();
        ws = null;
    }
    hideTyping();
    setRunning(false);
    document.getElementById('dialogue-status').textContent = '对话已手动停止';
}

function setRunning(running) {
    isRunning = running;
    document.getElementById('start-btn').disabled = running;
    document.getElementById('stop-btn').disabled = !running;
    document.getElementById('topic').disabled = running;
    document.getElementById('max-rounds').disabled = running;
}

function showExportButton() {
    let btn = document.getElementById('export-btn');
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'export-btn';
        btn.className = 'export-btn';
        btn.textContent = '复制对话记录';
        btn.onclick = exportDialogue;
        const section = document.querySelector('.dialogue-section');
        section.appendChild(btn);
    }
    btn.classList.add('show');
}

function hideExportButton() {
    const btn = document.getElementById('export-btn');
    if (btn) btn.classList.remove('show');
}

function exportDialogue() {
    const topic = document.getElementById('topic-display').textContent;
    const messages = document.querySelectorAll('.message-card');
    let text = `哲学讨论：${topic}\n${'='.repeat(40)}\n\n`;
    messages.forEach(card => {
        const name = card.querySelector('.message-name')?.textContent || '';
        const round = card.querySelector('.message-round')?.textContent || '';
        const source = card.querySelector('.source-badge')?.textContent || '';
        const content = card.querySelector('.message-content')?.textContent || '';
        const sourceNote = source ? ` [${source}]` : '';
        text += `【${name}】${round}${sourceNote}\n${content}\n\n`;
    });
    navigator.clipboard.writeText(text).then(() => {
        showExportToast();
    });
}

function showExportToast() {
    let toast = document.getElementById('export-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'export-toast';
        toast.className = 'export-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = '已复制到剪贴板';
    toast.classList.add('show');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => toast.classList.remove('show'), 2000);
}

function showToast(message) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 4000);
}

function saveDialogue() {
    if (dialogueMessages.length === 0) {
        sessionStorage.removeItem('philosopher_dialogue');
        return;
    }
    sessionStorage.setItem('philosopher_dialogue', JSON.stringify({
        topic: currentTopic,
        maxRounds: currentMaxRounds,
        messages: dialogueMessages,
    }));
}

function restoreDialogue() {
    try {
        const saved = sessionStorage.getItem('philosopher_dialogue');
        if (!saved) return;
        const data = JSON.parse(saved);
        if (!data.messages || data.messages.length === 0) return;

        currentTopic = data.topic || '';
        currentMaxRounds = data.maxRounds || 8;
        dialogueMessages = data.messages || [];

        document.getElementById('dialogue-topic').style.display = 'block';
        document.getElementById('topic-display').textContent = currentTopic;
        document.getElementById('topic').value = currentTopic;
        document.getElementById('max-rounds').value = currentMaxRounds;

        const container = document.getElementById('dialogue-messages');
        container.innerHTML = '';

        dialogueMessages.forEach(msg => {
            const p = philosophers.find(ph => ph.id === msg.philosopher_id);
            const sourceLabel = msg.source === 'simulation' ? '<span class="source-badge simulation">模拟回复</span>' : '';
            const card = document.createElement('div');
            card.className = 'message-card';
            card.innerHTML = `
                <div class="message-avatar" ${p ? `style="cursor:pointer" title="点击配置" onclick="openConfigModal('${p.id}')"` : ''}>
                    ${p ? p.avatar : '&#x1f4ac;'}
                </div>
                <div class="message-body">
                    <div class="message-header">
                        <span class="message-name">${msg.philosopher_name}</span>
                        ${sourceLabel}
                        <span class="message-round">第 ${msg.round_number} 轮</span>
                    </div>
                    <div class="message-content">${msg.content}</div>
                </div>
            `;
            container.appendChild(card);
        });

        document.getElementById('dialogue-status').textContent = '对话已恢复';
        document.getElementById('dialogue-status').className = 'status-bar completed';
        showExportButton();
    } catch (e) {
        sessionStorage.removeItem('philosopher_dialogue');
    }
}
