diff --git a/To-do.html b/To-do.html
new file mode 100644
index 0000000..40fb71e
--- /dev/null
+++ b/To-do.html
@@ -0,0 +1,857 @@
+<!DOCTYPE html>
+<html lang="en">
+<head>
+  <meta charset="UTF-8">
+  <meta name="viewport" content="width=device-width, initial-scale=1.0">
+  <title>Digital Book Planner</title>
+  <link rel="preconnect" href="https://fonts.googleapis.com">
+  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
+  <link href="https://fonts.googleapis.com/css2?family=Caveat:wght@500;600&family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
+  <style>
+    :root {
+      --bg-dark: #121519;
+      --cover-leather: #231c18;
+      --cover-edge: #382c26;
+      --paper-cream: #faf7f0;
+      --paper-edge: #eae4d5;
+      --text-main: #2c2925;
+      --text-muted: #8c8278;
+      --accent-brown: #8b5a2b;
+      --accent-hover: #6e451f;
+      --line-blue: rgba(70, 130, 180, 0.15);
+      --margin-red: rgba(220, 53, 69, 0.25);
+      --shadow-color: rgba(0, 0, 0, 0.4);
+      --font-ui: 'Outfit', sans-serif;
+      --font-hand: 'Caveat', cursive;
+    }
+
+    * { box-sizing: border-box; margin: 0; padding: 0; }
+
+    body {
+      background-color: var(--bg-dark);
+      background-image: 
+        radial-gradient(circle at 50% 30%, #1e242d 0%, #0d0f12 100%);
+      font-family: var(--font-ui);
+      color: var(--text-main);
+      min-height: 100vh;
+      display: flex;
+      flex-direction: column;
+      align-items: center;
+      justify-content: center;
+      padding: 20px;
+      overflow-x: hidden;
+    }
+
+    /* Top Control Bar */
+    .top-controls {
+      display: flex;
+      align-items: center;
+      gap: 16px;
+      margin-bottom: 24px;
+      background: rgba(255, 255, 255, 0.05);
+      padding: 10px 20px;
+      border-radius: 40px;
+      backdrop-filter: blur(10px);
+      box-shadow: 0 8px 24px rgba(0,0,0,0.3);
+      border: 1px solid rgba(255,255,255,0.1);
+      z-index: 100;
+    }
+
+    .nav-btn {
+      background: var(--accent-brown);
+      color: #fff;
+      border: none;
+      padding: 10px 18px;
+      border-radius: 20px;
+      font-weight: 500;
+      font-size: 14px;
+      cursor: pointer;
+      display: flex;
+      align-items: center;
+      gap: 6px;
+      transition: all 0.2s ease;
+    }
+    .nav-btn:hover { background: var(--accent-hover); transform: translateY(-1px); }
+    .nav-btn:active { transform: translateY(0); }
+    .nav-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
+
+    .date-display {
+      position: relative;
+      display: flex;
+      align-items: center;
+      gap: 8px;
+    }
+
+    .date-picker-input {
+      background: rgba(0, 0, 0, 0.4);
+      color: #faf7f0;
+      border: 1px solid rgba(255, 255, 255, 0.2);
+      padding: 8px 14px;
+      border-radius: 20px;
+      font-family: var(--font-ui);
+      font-size: 14px;
+      font-weight: 500;
+      outline: none;
+      cursor: pointer;
+    }
+    .date-picker-input::-webkit-calendar-picker-indicator {
+      filter: invert(1);
+      cursor: pointer;
+    }
+
+    .date-title {
+      color: #e5ded0;
+      font-size: 16px;
+      font-weight: 600;
+      min-width: 220px;
+      text-align: center;
+    }
+
+    /* Book Shell */
+    .book-viewport {
+      perspective: 1600px;
+      width: 100%;
+      max-width: 1100px;
+      display: flex;
+      justify-content: center;
+    }
+
+    .book {
+      position: relative;
+      width: 1000px;
+      height: 640px;
+      background: var(--cover-leather);
+      border-radius: 12px;
+      padding: 14px;
+      box-shadow: 
+        0 25px 50px -12px var(--shadow-color),
+        0 0 0 2px var(--cover-edge);
+      display: flex;
+      transform-style: preserve-3d;
+    }
+
+    /* Central Spine Shadow & Ribbon */
+    .book-spine-line {
+      position: absolute;
+      left: 50%;
+      top: 0;
+      bottom: 0;
+      width: 28px;
+      transform: translateX(-50%);
+      background: linear-gradient(to right, 
+        rgba(0,0,0,0.3) 0%, 
+        rgba(0,0,0,0.6) 45%, 
+        rgba(0,0,0,0.8) 50%, 
+        rgba(0,0,0,0.6) 55%, 
+        rgba(0,0,0,0.3) 100%);
+      z-index: 50;
+      pointer-events: none;
+    }
+
+    .bookmark-ribbon {
+      position: absolute;
+      left: 50%;
+      top: -10px;
+      width: 16px;
+      height: 120px;
+      background: #9e2a2b;
+      transform: translateX(-50%);
+      border-radius: 0 0 4px 4px;
+      box-shadow: 0 4px 10px rgba(0,0,0,0.4);
+      z-index: 55;
+      pointer-events: none;
+    }
+
+    /* Pages Container */
+    .pages-spread {
+      display: flex;
+      width: 100%;
+      height: 100%;
+      background: var(--paper-cream);
+      border-radius: 6px;
+      box-shadow: inset 0 0 20px rgba(0,0,0,0.08);
+      position: relative;
+      transform-style: preserve-3d;
+    }
+
+    .page {
+      flex: 1;
+      height: 100%;
+      padding: 36px 40px;
+      display: flex;
+      flex-direction: column;
+      position: relative;
+      background-color: var(--paper-cream);
+      overflow-y: auto;
+    }
+
+    .left-page {
+      border-right: 1px solid rgba(0,0,0,0.1);
+      box-shadow: inset -15px 0 25px -10px rgba(0,0,0,0.1);
+      border-radius: 6px 0 0 6px;
+    }
+
+    .right-page {
+      box-shadow: inset 15px 0 25px -10px rgba(0,0,0,0.1);
+      border-radius: 0 6px 6px 0;
+    }
+
+    .page-number {
+      position: absolute;
+      bottom: 16px;
+      font-size: 12px;
+      color: var(--text-muted);
+      font-weight: 500;
+    }
+    .left-page .page-number { left: 40px; }
+    .right-page .page-number { right: 40px; }
+
+    .page-header {
+      display: flex;
+      justify-content: space-between;
+      align-items: center;
+      border-bottom: 2px solid var(--text-main);
+      padding-bottom: 12px;
+      margin-bottom: 20px;
+    }
+
+    /* Task List Component Styles */
+    .task-input-wrapper {
+      display: flex;
+      gap: 8px;
+      margin-bottom: 20px;
+    }
+
+    .task-input {
+      flex: 1;
+      background: transparent;
+      border: 1px solid rgba(0,0,0,0.15);
+      border-bottom: 2px solid var(--text-main);
+      padding: 8px 12px;
+      font-family: var(--font-ui);
+      font-size: 15px;
+      outline: none;
+      transition: border-color 0.2s;
+    }
+    .task-input:focus {
+      border-bottom-color: var(--accent-brown);
+    }
+
+    .add-task-btn {
+      background: var(--text-main);
+      color: var(--paper-cream);
+      border: none;
+      padding: 8px 16px;
+      border-radius: 4px;
+      font-family: var(--font-ui);
+      font-size: 14px;
+      font-weight: 600;
+      cursor: pointer;
+      transition: background 0.2s;
+    }
+    .add-task-btn:hover { background: var(--accent-brown); }
+
+    .task-list {
+      list-style: none;
+      display: flex;
+      flex-direction: column;
+      gap: 10px;
+    }
+
+    .task-item {
+      display: flex;
+      align-items: center;
+      gap: 12px;
+      padding: 10px 12px;
+      background: rgba(255,255,255,0.6);
+      border-radius: 6px;
+      border: 1px solid rgba(0,0,0,0.05);
+      transition: all 0.2s ease;
+    }
+    .task-item:hover {
+      background: rgba(255,255,255,0.9);
+      box-shadow: 0 2px 8px rgba(0,0,0,0.04);
+    }
+
+    .task-checkbox {
+      width: 18px;
+      height: 18px;
+      accent-color: var(--accent-brown);
+      cursor: pointer;
+    }
+
+    .task-text {
+      flex: 1;
+      font-size: 15px;
+      font-weight: 400;
+      word-break: break-word;
+      transition: color 0.2s, text-decoration 0.2s;
+    }
+
+    .task-item.completed .task-text {
+      text-decoration: line-through;
+      color: var(--text-muted);
+    }
+
+    .delete-task-btn {
+      background: transparent;
+      border: none;
+      color: #d9534f;
+      font-size: 16px;
+      cursor: pointer;
+      opacity: 0.5;
+      padding: 2px 6px;
+      border-radius: 4px;
+      transition: opacity 0.2s, background 0.2s;
+    }
+    .task-item:hover .delete-task-btn { opacity: 1; }
+    .delete-task-btn:hover { background: rgba(217, 83, 79, 0.1); }
+
+    .empty-state {
+      text-align: center;
+      padding: 40px 20px;
+      color: var(--text-muted);
+      font-style: italic;
+      font-size: 14px;
+    }
+
+    /* Notes Component Styles */
+    #notes-container {
+      flex: 1;
+      display: flex;
+      flex-direction: column;
+      position: relative;
+      min-height: 400px;
+    }
+
+    .notes-wrapper {
+      position: relative;
+      flex: 1;
+      display: flex;
+      flex-direction: column;
+      width: 100%;
+      border-radius: 4px;
+      overflow: hidden;
+    }
+
+    .notes-margin-line {
+      position: absolute;
+      left: 36px;
+      top: 0;
+      bottom: 0;
+      width: 2px;
+      background-color: var(--margin-red);
+      z-index: 2;
+      pointer-events: none;
+    }
+
+    .notebook-textarea {
+      width: 100%;
+      flex: 1;
+      min-height: 420px;
+      background: transparent;
+      background-image: repeating-linear-gradient(
+        transparent,
+        transparent 27px,
+        var(--line-blue) 28px
+      );
+      background-attachment: local;
+      border: none;
+      outline: none;
+      resize: none;
+      font-family: var(--font-hand), var(--font-ui);
+      font-size: 22px;
+      line-height: 28px;
+      color: var(--text-main);
+      padding: 0 12px 0 48px;
+      box-sizing: border-box;
+    }
+
+    .notebook-textarea::placeholder {
+      color: var(--text-muted);
+      opacity: 0.6;
+      font-style: italic;
+      font-size: 20px;
+    }
+
+    #save-status-badge {
+      font-size: 12px;
+      color: var(--text-muted);
+      font-weight: 500;
+      transition: color 0.2s, font-weight 0.2s;
+    }
+
+    #save-status-badge.saving {
+      color: var(--accent-brown);
+      font-weight: 600;
+    }
+
+    /* 3D Spine-Pivot Page Flip Engine */
+    .flip-leaf {
+      position: absolute;
+      top: 0;
+      width: 50%;
+      height: 100%;
+      z-index: 40;
+      transform-style: preserve-3d;
+      pointer-events: none;
+    }
+
+    .flip-leaf.flip-next {
+      right: 0;
+      left: auto;
+      transform-origin: left center;
+      animation: flipNext 0.5s cubic-bezier(0.645, 0.045, 0.355, 1.000) forwards;
+    }
+
+    .flip-leaf.flip-prev {
+      left: 0;
+      right: auto;
+      transform-origin: right center;
+      animation: flipPrev 0.5s cubic-bezier(0.645, 0.045, 0.355, 1.000) forwards;
+    }
+
+    .flip-leaf-face {
+      position: absolute;
+      top: 0;
+      left: 0;
+      width: 100%;
+      height: 100%;
+      backface-visibility: hidden;
+      -webkit-backface-visibility: hidden;
+      background-color: var(--paper-cream);
+      box-shadow: inset 0 0 20px rgba(0,0,0,0.08);
+      display: flex;
+      flex-direction: column;
+      padding: 36px 40px;
+      overflow-y: auto;
+    }
+
+    .flip-leaf-front {
+      z-index: 2;
+      transform: rotateY(0deg);
+    }
+
+    .flip-leaf-back {
+      z-index: 1;
+      transform: rotateY(180deg);
+    }
+
+    @keyframes flipNext {
+      0% {
+        transform: rotateY(0deg);
+        box-shadow: -5px 0 15px rgba(0,0,0,0.1);
+      }
+      50% {
+        box-shadow: -25px 0 35px rgba(0,0,0,0.35);
+      }
+      100% {
+        transform: rotateY(-180deg);
+        box-shadow: 5px 0 15px rgba(0,0,0,0.1);
+      }
+    }
+
+    @keyframes flipPrev {
+      0% {
+        transform: rotateY(0deg);
+        box-shadow: 5px 0 15px rgba(0,0,0,0.1);
+      }
+      50% {
+        box-shadow: 25px 0 35px rgba(0,0,0,0.35);
+      }
+      100% {
+        transform: rotateY(180deg);
+        box-shadow: -5px 0 15px rgba(0,0,0,0.1);
+      }
+    }
+  </style>
+</head>
+<body>
+
+  <div class="top-controls">
+    <button class="nav-btn" id="prev-date-btn">← Prev Day</button>
+    <div class="date-display">
+      <input type="date" id="date-picker" class="date-picker-input">
+      <span class="date-title" id="date-formatted-title">Date</span>
+    </div>
+    <button class="nav-btn" id="today-btn">📅 Today</button>
+    <button class="nav-btn" id="next-date-btn">Next Day →</button>
+  </div>
+
+  <div class="book-viewport">
+    <div class="book">
+      <div class="book-spine-line"></div>
+      <div class="bookmark-ribbon"></div>
+
+      <div class="pages-spread">
+        <!-- Left Page: Daily Tasks -->
+        <div class="page left-page" id="left-page-content">
+          <div class="page-header">
+            <h2 class="page-title">Daily Action Tasks</h2>
+            <span id="task-counter-badge" style="font-size: 13px; font-weight:600; color: var(--accent-brown); background: rgba(139, 90, 43, 0.1); padding: 4px 10px; border-radius: 12px;">0 / 0 Done</span>
+          </div>
+          <div id="tasks-container">
+            <!-- Dynamic Task List HTML will go here -->
+          </div>
+          <div class="page-number">Page 1</div>
+        </div>
+
+        <!-- Right Page: Thoughts & Notes -->
+        <div class="page right-page" id="right-page-content">
+          <div class="page-header">
+            <h2 class="page-title">Thoughts & Notes</h2>
+            <span id="save-status-badge" style="font-size: 12px; color: var(--text-muted); font-weight: 500;">Saved ✓</span>
+          </div>
+          <div id="notes-container">
+            <!-- Dynamic Notes HTML will go here -->
+          </div>
+          <div class="page-number">Page 2</div>
+        </div>
+      </div>
+    </div>
+  </div>
+
+  <script>
+    const STORAGE_KEY = 'todo_book_planner_v1';
+    let currentDate = getTodayDateStr();
+    let isAnimating = false;
+    let currentTasks = [];
+    let currentNotes = '';
+    let notesDebounceTimer = null;
+
+    function getTodayDateStr() {
+      const d = new Date();
+      const year = d.getFullYear();
+      const month = String(d.getMonth() + 1).padStart(2, '0');
+      const day = String(d.getDate()).padStart(2, '0');
+      return `${year}-${month}-${day}`;
+    }
+
+    function addDays(dateStr, days) {
+      const parts = dateStr.split('-');
+      const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
+      d.setDate(d.getDate() + days);
+      const y = d.getFullYear();
+      const m = String(d.getMonth() + 1).padStart(2, '0');
+      const day = String(d.getDate()).padStart(2, '0');
+      return `${y}-${m}-${day}`;
+    }
+
+    function formatDateTitle(dateStr) {
+      if (!dateStr) return '';
+      const parts = dateStr.split('-');
+      if (parts.length !== 3) return dateStr;
+      const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
+      return d.toLocaleDateString('en-US', {
+        weekday: 'short',
+        month: 'short',
+        day: 'numeric',
+        year: 'numeric'
+      });
+    }
+
+    function getStoreData() {
+      try {
+        const raw = localStorage.getItem(STORAGE_KEY);
+        return raw ? JSON.parse(raw) : {};
+      } catch (e) {
+        console.error('Error reading localStorage:', e);
+        return {};
+      }
+    }
+
+    function saveStoreData(store) {
+      try {
+        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
+      } catch (e) {
+        console.error('Error writing to localStorage:', e);
+      }
+    }
+
+    function loadDateData(dateStr) {
+      const store = getStoreData();
+      const data = store[dateStr] || {};
+      return {
+        tasks: Array.isArray(data.tasks) ? data.tasks : [],
+        notes: typeof data.notes === 'string' ? data.notes : ''
+      };
+    }
+
+    function saveCurrentDateData() {
+      if (notesDebounceTimer) {
+        clearTimeout(notesDebounceTimer);
+        notesDebounceTimer = null;
+      }
+      const textarea = document.getElementById('notebook-textarea');
+      if (textarea) {
+        currentNotes = textarea.value;
+      }
+      const store = getStoreData();
+      store[currentDate] = {
+        tasks: currentTasks,
+        notes: currentNotes
+      };
+      saveStoreData(store);
+    }
+
+    function addTask(text) {
+      currentTasks.push({ id: 't_' + Date.now(), text: text, completed: false });
+      saveCurrentDateData();
+      renderTasks(currentTasks);
+    }
+
+    function toggleTask(taskId) {
+      currentTasks = currentTasks.map(t => t.id === taskId ? { ...t, completed: !t.completed } : t);
+      saveCurrentDateData();
+      renderTasks(currentTasks);
+    }
+
+    function deleteTask(taskId) {
+      currentTasks = currentTasks.filter(t => t.id !== taskId);
+      saveCurrentDateData();
+      renderTasks(currentTasks);
+    }
+
+    function renderTasks(tasks) {
+      const container = document.getElementById('tasks-container');
+      const counterBadge = document.getElementById('task-counter-badge');
+      
+      const total = tasks.length;
+      const completed = tasks.filter(t => t.completed).length;
+      if (counterBadge) {
+        counterBadge.textContent = `${completed} / ${total} Done`;
+      }
+
+      if (!container) return;
+
+      container.innerHTML = `
+        <div class="task-input-wrapper">
+          <input type="text" id="new-task-input" class="task-input" placeholder="Add a new task for today..." />
+          <button id="add-task-btn" class="add-task-btn">Add</button>
+        </div>
+        <ul class="task-list" id="task-ul">
+          ${total === 0 ? `<li class="empty-state">No tasks recorded for this date. Click above to add one!</li>` : ''}
+          ${tasks.map(task => `
+            <li class="task-item ${task.completed ? 'completed' : ''}" data-id="${task.id}">
+              <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''} onchange="toggleTask('${task.id}')" />
+              <span class="task-text">${escapeHtml(task.text)}</span>
+              <button class="delete-task-btn" onclick="deleteTask('${task.id}')" title="Delete Task">✕</button>
+            </li>
+          `).join('')}
+        </ul>
+      `;
+
+      const input = document.getElementById('new-task-input');
+      const btn = document.getElementById('add-task-btn');
+      
+      function handleAdd() {
+        const text = input.value.trim();
+        if (text) {
+          addTask(text);
+        }
+      }
+
+      if (btn && input) {
+        btn.addEventListener('click', handleAdd);
+        input.addEventListener('keypress', (e) => {
+          if (e.key === 'Enter') handleAdd();
+        });
+      }
+    }
+
+    function saveNotes(notesText) {
+      currentNotes = notesText;
+      saveCurrentDateData();
+    }
+
+    function renderNotes(notesText) {
+      if (notesText !== undefined) {
+        currentNotes = notesText;
+      }
+      const container = document.getElementById('notes-container');
+      if (!container) return;
+
+      container.innerHTML = `
+        <div class="notes-wrapper">
+          <div class="notes-margin-line"></div>
+          <textarea id="notebook-textarea" class="notebook-textarea" placeholder="Write your thoughts, reflections, or notes for today..."></textarea>
+        </div>
+      `;
+
+      const textarea = document.getElementById('notebook-textarea');
+      const statusBadge = document.getElementById('save-status-badge');
+
+      if (textarea) {
+        textarea.value = currentNotes;
+
+        textarea.addEventListener('input', (e) => {
+          const val = e.target.value;
+          currentNotes = val;
+          if (statusBadge) {
+            statusBadge.textContent = 'Saving...';
+            statusBadge.classList.add('saving');
+          }
+          if (notesDebounceTimer) {
+            clearTimeout(notesDebounceTimer);
+          }
+          notesDebounceTimer = setTimeout(() => {
+            saveNotes(val);
+            if (statusBadge) {
+              statusBadge.textContent = 'Saved ✓';
+              statusBadge.classList.remove('saving');
+            }
+          }, 300);
+        });
+      }
+    }
+
+    function generatePageHTML(side, data, dateStr) {
+      if (side === 'left') {
+        const tasks = data.tasks || [];
+        const total = tasks.length;
+        const completed = tasks.filter(t => t.completed).length;
+        return `
+          <div class="page-header">
+            <h2 class="page-title">Daily Action Tasks</h2>
+            <span class="task-counter-badge" style="font-size: 13px; font-weight:600; color: var(--accent-brown); background: rgba(139, 90, 43, 0.1); padding: 4px 10px; border-radius: 12px;">${completed} / ${total} Done</span>
+          </div>
+          <div class="tasks-container-preview">
+            <ul class="task-list">
+              ${total === 0 ? `<li class="empty-state">No tasks recorded for this date.</li>` : ''}
+              ${tasks.map(task => `
+                <li class="task-item ${task.completed ? 'completed' : ''}">
+                  <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''} disabled />
+                  <span class="task-text">${escapeHtml(task.text)}</span>
+                </li>
+              `).join('')}
+            </ul>
+          </div>
+          <div class="page-number">Page 1</div>
+        `;
+      } else {
+        const notes = data.notes || '';
+        return `
+          <div class="page-header">
+            <h2 class="page-title">Thoughts & Notes</h2>
+            <span style="font-size: 12px; color: var(--text-muted); font-weight: 500;">Saved ✓</span>
+          </div>
+          <div class="notes-container-preview" style="flex:1; display:flex; flex-direction:column; position:relative;">
+            <div class="notes-wrapper" style="flex:1; position:relative;">
+              <div class="notes-margin-line"></div>
+              <div class="notebook-textarea" style="white-space: pre-wrap; font-family: var(--font-hand); font-size:22px; line-height:28px; padding: 0 12px 0 48px;">${escapeHtml(notes)}</div>
+            </div>
+          </div>
+          <div class="page-number">Page 2</div>
+        `;
+      }
+    }
+
+    function setControlsDisabled(disabled) {
+      const prevBtn = document.getElementById('prev-date-btn');
+      const nextBtn = document.getElementById('next-date-btn');
+      const todayBtn = document.getElementById('today-btn');
+      const datePicker = document.getElementById('date-picker');
+      
+      if (prevBtn) prevBtn.disabled = disabled;
+      if (nextBtn) nextBtn.disabled = disabled;
+      if (todayBtn) todayBtn.disabled = disabled;
+      if (datePicker) datePicker.disabled = disabled;
+    }
+
+    function updateDateDisplay() {
+      const datePicker = document.getElementById('date-picker');
+      const titleSpan = document.getElementById('date-formatted-title');
+      if (datePicker) datePicker.value = currentDate;
+      if (titleSpan) titleSpan.textContent = formatDateTitle(currentDate);
+    }
+
+    function performPageFlipAnimation(isNext, targetDate, targetData, midpointCallback) {
+      if (isAnimating) return;
+      isAnimating = true;
+
+      const pagesSpread = document.querySelector('.pages-spread');
+      const leftPage = document.getElementById('left-page-content');
+      const rightPage = document.getElementById('right-page-content');
+
+      const leaf = document.createElement('div');
+      leaf.className = `flip-leaf ${isNext ? 'flip-next' : 'flip-prev'}`;
+
+      const frontFace = document.createElement('div');
+      frontFace.className = `flip-leaf-face flip-leaf-front ${isNext ? 'right-page' : 'left-page'}`;
+      frontFace.innerHTML = isNext ? rightPage.innerHTML : leftPage.innerHTML;
+
+      const backFace = document.createElement('div');
+      backFace.className = `flip-leaf-face flip-leaf-back ${isNext ? 'left-page' : 'right-page'}`;
+      backFace.innerHTML = generatePageHTML(isNext ? 'left' : 'right', targetData, targetDate);
+
+      leaf.appendChild(frontFace);
+      leaf.appendChild(backFace);
+      pagesSpread.appendChild(leaf);
+
+      setControlsDisabled(true);
+
+      setTimeout(() => {
+        if (midpointCallback) midpointCallback();
+      }, 250);
+
+      setTimeout(() => {
+        if (leaf.parentNode) {
+          leaf.parentNode.removeChild(leaf);
+        }
+        isAnimating = false;
+        setControlsDisabled(false);
+      }, 500);
+    }
+
+    function switchDate(targetDate, forceNext = null) {
+      if (isAnimating || !targetDate || targetDate === currentDate) return;
+
+      saveCurrentDateData();
+
+      const isNext = forceNext !== null ? forceNext : (targetDate > currentDate);
+      const targetData = loadDateData(targetDate);
+
+      performPageFlipAnimation(isNext, targetDate, targetData, () => {
+        currentDate = targetDate;
+        currentTasks = targetData.tasks;
+        currentNotes = targetData.notes;
+        updateDateDisplay();
+        renderTasks(currentTasks);
+        renderNotes(currentNotes);
+      });
+    }
+
+    function escapeHtml(str) {
+      if (!str) return '';
+      return str.replace(/[&<>'"]/g, 
+        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
+      );
+    }
+
+    // Initial render on DOM load
+    window.addEventListener('DOMContentLoaded', () => {
+      currentDate = getTodayDateStr();
+      const initialData = loadDateData(currentDate);
+      currentTasks = initialData.tasks;
+      currentNotes = initialData.notes;
+
+      updateDateDisplay();
+      renderTasks(currentTasks);
+      renderNotes(currentNotes);
+
+      const prevBtn = document.getElementById('prev-date-btn');
+      const nextBtn = document.getElementById('next-date-btn');
+      const todayBtn = document.getElementById('today-btn');
+      const datePicker = document.getElementById('date-picker');
+
+      if (prevBtn) prevBtn.addEventListener('click', () => switchDate(addDays(currentDate, -1), false));
+      if (nextBtn) nextBtn.addEventListener('click', () => switchDate(addDays(currentDate, 1), true));
+      if (todayBtn) todayBtn.addEventListener('click', () => switchDate(getTodayDateStr()));
+      if (datePicker) datePicker.addEventListener('change', (e) => {
+        if (e.target.value) switchDate(e.target.value);
+      });
+    });
+  </script>
+</body>
+</html>
+
