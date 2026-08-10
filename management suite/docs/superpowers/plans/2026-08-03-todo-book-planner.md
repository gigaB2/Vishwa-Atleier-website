# Interactive Digital Book Planner (`To-do.html`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single, standalone, fully functional `To-do.html` file that operates as an interactive digital book planner featuring side-by-side 2-page spreads, actionable daily tasks, ruled journal notes, date persistence via `localStorage`, and realistic 3D spine-pivot page-turning animations.

**Architecture:** A pure single-file application (HTML + CSS + vanilla JS). CSS 3D transforms (`transform-style: preserve-3d`, `perspective`) create an open hardcover journal with two distinct pages. Date-based state (`YYYY-MM-DD`) is read/written to browser `localStorage`. A dynamic 3D leaf flipper handles forward and backward page transitions smoothly.

**Tech Stack:** HTML5, CSS3 3D Transforms, Vanilla JavaScript (ES6+), Browser LocalStorage API, Google Fonts (Outfit & Caveat).

## Global Constraints
- **File Output:** Single file `To-do.html` at the workspace root (`C:\Users\Admin\Desktop\work\main\To-do.html`).
- **Dependencies:** 0 external CSS/JS dependencies required; optional Google Fonts loaded via CDN link.
- **Data Persistence:** `localStorage` key `todo_book_planner_v1`.
- **Browser Compatibility:** Standalone execution in standard desktop/mobile modern browsers.

---

### Task 1: HTML Structure, Book Frame & Parchment CSS Design System

**Files:**
- Create: `To-do.html`

**Interfaces:**
- Produces: Base HTML DOM layout with `.book-container`, `.book-wrapper`, `.page.left-page`, `.page.right-page`, header date navigation controls, and CSS variables for the book theme.

- [ ] **Step 1: Create `To-do.html` with HTML structure and CSS design system**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Digital Book Planner</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Caveat:wght@500;600&family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-dark: #121519;
      --cover-leather: #231c18;
      --cover-edge: #382c26;
      --paper-cream: #faf7f0;
      --paper-edge: #eae4d5;
      --text-main: #2c2925;
      --text-muted: #8c8278;
      --accent-brown: #8b5a2b;
      --accent-hover: #6e451f;
      --line-blue: rgba(70, 130, 180, 0.15);
      --margin-red: rgba(220, 53, 69, 0.25);
      --shadow-color: rgba(0, 0, 0, 0.4);
      --font-ui: 'Outfit', sans-serif;
      --font-hand: 'Caveat', cursive;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background-color: var(--bg-dark);
      background-image: 
        radial-gradient(circle at 50% 30%, #1e242d 0%, #0d0f12 100%);
      font-family: var(--font-ui);
      color: var(--text-main);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
      overflow-x: hidden;
    }

    /* Top Control Bar */
    .top-controls {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 24px;
      background: rgba(255, 255, 255, 0.05);
      padding: 10px 20px;
      border-radius: 40px;
      backdrop-filter: blur(10px);
      box-shadow: 0 8px 24px rgba(0,0,0,0.3);
      border: 1px solid rgba(255,255,255,0.1);
      z-index: 100;
    }

    .nav-btn {
      background: var(--accent-brown);
      color: #fff;
      border: none;
      padding: 10px 18px;
      border-radius: 20px;
      font-weight: 500;
      font-size: 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s ease;
    }
    .nav-btn:hover { background: var(--accent-hover); transform: translateY(-1px); }
    .nav-btn:active { transform: translateY(0); }
    .nav-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

    .date-display {
      position: relative;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .date-picker-input {
      background: rgba(0, 0, 0, 0.4);
      color: #faf7f0;
      border: 1px solid rgba(255, 255, 255, 0.2);
      padding: 8px 14px;
      border-radius: 20px;
      font-family: var(--font-ui);
      font-size: 14px;
      font-weight: 500;
      outline: none;
      cursor: pointer;
    }
    .date-picker-input::-webkit-calendar-picker-indicator {
      filter: invert(1);
      cursor: pointer;
    }

    .date-title {
      color: #e5ded0;
      font-size: 16px;
      font-weight: 600;
      min-width: 220px;
      text-align: center;
    }

    /* Book Shell */
    .book-viewport {
      perspective: 1600px;
      width: 100%;
      max-width: 1100px;
      display: flex;
      justify-content: center;
    }

    .book {
      position: relative;
      width: 1000px;
      height: 640px;
      background: var(--cover-leather);
      border-radius: 12px;
      padding: 14px;
      box-shadow: 
        0 25px 50px -12px var(--shadow-color),
        0 0 0 2px var(--cover-edge);
      display: flex;
      transform-style: preserve-3d;
    }

    /* Central Spine Shadow & Ribbon */
    .book-spine-line {
      position: absolute;
      left: 50%;
      top: 0;
      bottom: 0;
      width: 28px;
      transform: translateX(-50%);
      background: linear-gradient(to right, 
        rgba(0,0,0,0.3) 0%, 
        rgba(0,0,0,0.6) 45%, 
        rgba(0,0,0,0.8) 50%, 
        rgba(0,0,0,0.6) 55%, 
        rgba(0,0,0,0.3) 100%);
      z-index: 50;
      pointer-events: none;
    }

    .bookmark-ribbon {
      position: absolute;
      left: 50%;
      top: -10px;
      width: 16px;
      height: 120px;
      background: #9e2a2b;
      transform: translateX(-50%);
      border-radius: 0 0 4px 4px;
      box-shadow: 0 4px 10px rgba(0,0,0,0.4);
      z-index: 55;
      pointer-events: none;
    }

    /* Pages Container */
    .pages-spread {
      display: flex;
      width: 100%;
      height: 100%;
      background: var(--paper-cream);
      border-radius: 6px;
      overflow: hidden;
      box-shadow: inset 0 0 20px rgba(0,0,0,0.08);
      position: relative;
    }

    .page {
      flex: 1;
      height: 100%;
      padding: 36px 40px;
      display: flex;
      flex-direction: column;
      position: relative;
      background-color: var(--paper-cream);
      overflow-y: auto;
    }

    .left-page {
      border-right: 1px solid rgba(0,0,0,0.1);
      box-shadow: inset -15px 0 25px -10px rgba(0,0,0,0.1);
    }

    .right-page {
      box-shadow: inset 15px 0 25px -10px rgba(0,0,0,0.1);
    }

    .page-number {
      position: absolute;
      bottom: 16px;
      font-size: 12px;
      color: var(--text-muted);
      font-weight: 500;
    }
    .left-page .page-number { left: 40px; }
    .right-page .page-number { right: 40px; }

    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid var(--text-main);
      padding-bottom: 12px;
      margin-bottom: 20px;
    }

    .page-title {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.5px;
      text-transform: uppercase;
    }
  </style>
</head>
<body>

  <div class="top-controls">
    <button class="nav-btn" id="prev-date-btn">← Prev Day</button>
    <div class="date-display">
      <input type="date" id="date-picker" class="date-picker-input">
      <span class="date-title" id="date-formatted-title">Date</span>
    </div>
    <button class="nav-btn" id="today-btn">📅 Today</button>
    <button class="nav-btn" id="next-date-btn">Next Day →</button>
  </div>

  <div class="book-viewport">
    <div class="book">
      <div class="book-spine-line"></div>
      <div class="bookmark-ribbon"></div>

      <div class="pages-spread">
        <!-- Left Page: Daily Tasks -->
        <div class="page left-page" id="left-page-content">
          <div class="page-header">
            <h2 class="page-title">Daily Action Tasks</h2>
            <span id="task-counter-badge" style="font-size: 13px; font-weight:600; color: var(--accent-brown); background: rgba(139, 90, 43, 0.1); padding: 4px 10px; border-radius: 12px;">0 / 0 Done</span>
          </div>
          <div id="tasks-container">
            <!-- Dynamic Task List HTML will go here -->
          </div>
          <div class="page-number">Page 1</div>
        </div>

        <!-- Right Page: Thoughts & Notes -->
        <div class="page right-page" id="right-page-content">
          <div class="page-header">
            <h2 class="page-title">Thoughts & Notes</h2>
            <span id="save-status-badge" style="font-size: 12px; color: var(--text-muted); font-weight: 500;">Saved ✓</span>
          </div>
          <div id="notes-container">
            <!-- Dynamic Notes HTML will go here -->
          </div>
          <div class="page-number">Page 2</div>
        </div>
      </div>
    </div>
  </div>

</body>
</html>
```

- [ ] **Step 2: Verify structure in browser**

Command: Open `To-do.html` directly in browser or launch test server to check initial hardcover book rendering.

- [ ] **Step 3: Commit**

```bash
git add To-do.html
git commit -m "feat: initial HTML structure and hardcover book CSS design system"
```

---

### Task 2: Actionable Task List System (Left Page)

**Files:**
- Modify: `To-do.html`

**Interfaces:**
- Consumes: `#left-page-content`, `#task-counter-badge`, `#tasks-container`
- Produces: Interactive task input field, task creation, custom styled checkboxes, completion strikethrough, task deletion, and progress updates.

- [ ] **Step 1: Add Task CSS Styles to `To-do.html`**

```css
    /* Task List Component Styles */
    .task-input-wrapper {
      display: flex;
      gap: 8px;
      margin-bottom: 20px;
    }

    .task-input {
      flex: 1;
      background: transparent;
      border: 1px solid rgba(0,0,0,0.15);
      border-bottom: 2px solid var(--text-main);
      padding: 8px 12px;
      font-family: var(--font-ui);
      font-size: 15px;
      outline: none;
      transition: border-color 0.2s;
    }
    .task-input:focus {
      border-bottom-color: var(--accent-brown);
    }

    .add-task-btn {
      background: var(--text-main);
      color: var(--paper-cream);
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      font-family: var(--font-ui);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    .add-task-btn:hover { background: var(--accent-brown); }

    .task-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .task-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      background: rgba(255,255,255,0.6);
      border-radius: 6px;
      border: 1px solid rgba(0,0,0,0.05);
      transition: all 0.2s ease;
    }
    .task-item:hover {
      background: rgba(255,255,255,0.9);
      box-shadow: 0 2px 8px rgba(0,0,0,0.04);
    }

    .task-checkbox {
      width: 18px;
      height: 18px;
      accent-color: var(--accent-brown);
      cursor: pointer;
    }

    .task-text {
      flex: 1;
      font-size: 15px;
      font-weight: 400;
      word-break: break-word;
      transition: color 0.2s, text-decoration 0.2s;
    }

    .task-item.completed .task-text {
      text-decoration: line-through;
      color: var(--text-muted);
    }

    .delete-task-btn {
      background: transparent;
      border: none;
      color: #d9534f;
      font-size: 16px;
      cursor: pointer;
      opacity: 0.5;
      padding: 2px 6px;
      border-radius: 4px;
      transition: opacity 0.2s, background 0.2s;
    }
    .task-item:hover .delete-task-btn { opacity: 1; }
    .delete-task-btn:hover { background: rgba(217, 83, 79, 0.1); }

    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: var(--text-muted);
      font-style: italic;
      font-size: 14px;
    }
```

- [ ] **Step 2: Add Task JS Logic to `To-do.html`**

```javascript
    // Global Task Rendering Function
    function renderTasks(tasks) {
      const container = document.getElementById('tasks-container');
      const counterBadge = document.getElementById('task-counter-badge');
      
      const total = tasks.length;
      const completed = tasks.filter(t => t.completed).length;
      counterBadge.textContent = `${completed} / ${total} Done`;

      container.innerHTML = `
        <div class="task-input-wrapper">
          <input type="text" id="new-task-input" class="task-input" placeholder="Add a new task for today..." />
          <button id="add-task-btn" class="add-task-btn">Add</button>
        </div>
        <ul class="task-list" id="task-ul">
          ${total === 0 ? `<li class="empty-state">No tasks recorded for this date. Click above to add one!</li>` : ''}
          ${tasks.map(task => `
            <li class="task-item ${task.completed ? 'completed' : ''}" data-id="${task.id}">
              <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''} onchange="toggleTask('${task.id}')" />
              <span class="task-text">${escapeHtml(task.text)}</span>
              <button class="delete-task-btn" onclick="deleteTask('${task.id}')" title="Delete Task">✕</button>
            </li>
          `).join('')}
        </ul>
      `;

      // Event listener for task input
      const input = document.getElementById('new-task-input');
      const btn = document.getElementById('add-task-btn');
      
      function handleAdd() {
        const text = input.value.trim();
        if (text) {
          addTask(text);
        }
      }

      btn.addEventListener('click', handleAdd);
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleAdd();
      });
    }

    function escapeHtml(str) {
      return str.replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
      );
    }
```

- [ ] **Step 3: Verify Task UI interactivity**

Test: Adding, checking off, and deleting tasks in the rendered interface.

- [ ] **Step 4: Commit**

```bash
git add To-do.html
git commit -m "feat: implement Left Page daily tasks component with interactive checkboxes and state management"
```

---

### Task 3: Ruled Journal & Notes System (Right Page)

**Files:**
- Modify: `To-do.html`

**Interfaces:**
- Consumes: `#right-page-content`, `#notes-container`, `#save-status-badge`
- Produces: Ruled notebook textarea, debounced auto-saving on typing, status indicator updates.

- [ ] **Step 1: Add Lined Notebook CSS Styles to `To-do.html`**

```css
    /* Right Page Lined Notebook Styles */
    .notes-wrapper {
      position: relative;
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    .notebook-textarea {
      width: 100%;
      height: 100%;
      min-height: 420px;
      flex: 1;
      background: repeating-linear-gradient(
        transparent,
        transparent 27px,
        var(--line-blue) 28px
      );
      border: none;
      outline: none;
      line-height: 28px;
      font-family: var(--font-hand), var(--font-ui);
      font-size: 20px;
      color: var(--text-main);
      padding: 0 4px;
      resize: none;
      box-shadow: none;
    }

    .notes-margin-line {
      position: absolute;
      top: 0;
      bottom: 0;
      left: -12px;
      width: 2px;
      background: var(--margin-red);
      pointer-events: none;
    }
```

- [ ] **Step 2: Add Notes Render & Debounced Auto-Save JS Logic**

```javascript
    let autoSaveTimeout = null;

    function renderNotes(notesText) {
      const container = document.getElementById('notes-container');
      container.innerHTML = `
        <div class="notes-wrapper">
          <div class="notes-margin-line"></div>
          <textarea id="notes-textarea" class="notebook-textarea" placeholder="Write your thoughts, reflections, or notes for today...">${escapeHtml(notesText || '')}</textarea>
        </div>
      `;

      const textarea = document.getElementById('notes-textarea');
      textarea.addEventListener('input', (e) => {
        updateSaveStatus('Saving...');
        clearTimeout(autoSaveTimeout);
        autoSaveTimeout = setTimeout(() => {
          saveCurrentDateNotes(e.target.value);
          updateSaveStatus('Saved ✓');
        }, 300);
      });
    }

    function updateSaveStatus(statusText) {
      const badge = document.getElementById('save-status-badge');
      if (badge) badge.textContent = statusText;
    }
```

- [ ] **Step 3: Commit**

```bash
git add To-do.html
git commit -m "feat: implement Right Page ruled notebook notes component with debounced auto-saving"
```

---

### Task 4: 3D Spine-Pivot Page Flip Engine & LocalStorage Persistence Integration

**Files:**
- Modify: `To-do.html`

**Interfaces:**
- Consumes: `localStorage` key `todo_book_planner_v1`
- Produces: Date state management (`currentDate`), page load/render, smooth 3D page flip rotation animations on date change.

- [ ] **Step 1: Add 3D Flip Leaf Animation CSS Styles**

```css
    /* 3D Page Flip Leaf Overlay Styles */
    .flip-leaf {
      position: absolute;
      top: 0;
      left: 50%;
      width: 50%;
      height: 100%;
      transform-style: preserve-3d;
      z-index: 80;
      pointer-events: none;
    }

    .flip-leaf-face {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      backface-visibility: hidden;
      background: var(--paper-cream);
      padding: 36px 40px;
      overflow: hidden;
    }

    .flip-leaf-front {
      z-index: 2;
      box-shadow: inset 15px 0 25px -10px rgba(0,0,0,0.15);
    }

    .flip-leaf-back {
      transform: rotateY(180deg);
      z-index: 1;
      box-shadow: inset -15px 0 25px -10px rgba(0,0,0,0.15);
    }

    /* Page Turning Keyframes */
    @keyframes flipNext {
      0% { transform: rotateY(0deg); }
      100% { transform: rotateY(-180deg); }
    }

    @keyframes flipPrev {
      0% { transform: rotateY(0deg); }
      100% { transform: rotateY(180deg); }
    }
```

- [ ] **Step 2: Add State Management & 3D Page Turning JS Logic**

```javascript
    const STORAGE_KEY = 'todo_book_planner_v1';
    let currentDate = getTodayString();
    let isAnimating = false;

    function getTodayString() {
      const today = new Date();
      return formatDateKey(today);
    }

    function formatDateKey(dateObj) {
      const year = dateObj.getFullYear();
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const day = String(dateObj.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    function formatDisplayTitle(dateStr) {
      const parts = dateStr.split('-');
      const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
      const options = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
      return dateObj.toLocaleDateString('en-US', options);
    }

    function loadAppData() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
      } catch (e) {
        return {};
      }
    }

    function saveAppData(data) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    function getDateData(dateStr) {
      const appData = loadAppData();
      return appData[dateStr] || { tasks: [], notes: '' };
    }

    function saveDateData(dateStr, dataObj) {
      const appData = loadAppData();
      appData[dateStr] = dataObj;
      saveAppData(appData);
    }

    function loadCurrentSpread() {
      const data = getDateData(currentDate);
      
      // Update Date Navigation Controls
      document.getElementById('date-picker').value = currentDate;
      document.getElementById('date-formatted-title').textContent = formatDisplayTitle(currentDate);

      renderTasks(data.tasks);
      renderNotes(data.notes);
    }

    function addTask(text) {
      const data = getDateData(currentDate);
      const newTask = {
        id: 't_' + Date.now(),
        text: text,
        completed: false
      };
      data.tasks.push(newTask);
      saveDateData(currentDate, data);
      renderTasks(data.tasks);
    }

    function toggleTask(taskId) {
      const data = getDateData(currentDate);
      data.tasks = data.tasks.map(t => t.id === taskId ? { ...t, completed: !t.completed } : t);
      saveDateData(currentDate, data);
      renderTasks(data.tasks);
    }

    function deleteTask(taskId) {
      const data = getDateData(currentDate);
      data.tasks = data.tasks.filter(t => t.id !== taskId);
      saveDateData(currentDate, data);
      renderTasks(data.tasks);
    }

    function saveCurrentDateNotes(notesText) {
      const data = getDateData(currentDate);
      data.notes = notesText;
      saveDateData(currentDate, data);
    }

    // 3D Page Flip Transition Engine
    function navigateDate(daysOffset, targetDateStr = null) {
      if (isAnimating) return;

      let newDateStr;
      if (targetDateStr) {
        newDateStr = targetDateStr;
      } else {
        const parts = currentDate.split('-');
        const current = new Date(parts[0], parts[1] - 1, parts[2]);
        current.setDate(current.getDate() + daysOffset);
        newDateStr = formatDateKey(current);
      }

      if (newDateStr === currentDate) return;

      const isNext = newDateStr > currentDate;
      performPageFlipAnimation(isNext, () => {
        currentDate = newDateStr;
        loadCurrentSpread();
      });
    }

    function performPageFlipAnimation(isNext, updateContentCallback) {
      isAnimating = true;
      const spread = document.querySelector('.pages-spread');

      const leaf = document.createElement('div');
      leaf.className = 'flip-leaf';
      leaf.style.transformOrigin = isNext ? 'left center' : 'right center';
      if (!isNext) leaf.style.left = '0';

      const frontFace = document.createElement('div');
      frontFace.className = 'flip-leaf-face flip-leaf-front';
      frontFace.innerHTML = isNext ? document.getElementById('right-page-content').innerHTML : document.getElementById('left-page-content').innerHTML;

      const backFace = document.createElement('div');
      backFace.className = 'flip-leaf-face flip-leaf-back';
      
      leaf.appendChild(frontFace);
      leaf.appendChild(backFace);
      spread.appendChild(leaf);

      // Trigger CSS Keyframe
      leaf.style.animation = `${isNext ? 'flipNext' : 'flipPrev'} 0.5s ease-in-out forwards`;

      setTimeout(() => {
        updateContentCallback();
      }, 250);

      setTimeout(() => {
        leaf.remove();
        isAnimating = false;
      }, 500);
    }

    // Initialize Event Listeners
    window.addEventListener('DOMContentLoaded', () => {
      loadCurrentSpread();

      document.getElementById('prev-date-btn').addEventListener('click', () => navigateDate(-1));
      document.getElementById('next-date-btn').addEventListener('click', () => navigateDate(1));
      document.getElementById('today-btn').addEventListener('click', () => navigateDate(0, getTodayString()));
      
      document.getElementById('date-picker').addEventListener('change', (e) => {
        if (e.target.value) {
          navigateDate(0, e.target.value);
        }
      });
    });
```

- [ ] **Step 3: Verification & Interactive Testing**

1. Launch `To-do.html` in browser.
2. Click "Next Day →" and "← Prev Day" to confirm the smooth 3D page flip transition.
3. Select a specific date via the Date Picker.
4. Add tasks and type notes for Date A.
5. Navigate to Date B. Verify Date B starts clean or with its saved data.
6. Navigate back to Date A. Confirm all tasks, checkbox states, and notebook notes persist intact.

- [ ] **Step 4: Commit**

```bash
git add To-do.html
git commit -m "feat: complete interactive digital book planner with 3D page flip animations and date-based localStorage persistence"
```
