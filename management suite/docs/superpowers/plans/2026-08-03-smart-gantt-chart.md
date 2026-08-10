# Smart Gantt Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Smart Gantt Chart modal overlay for daily tasks in `To-do.html` with smart 1-hour time allocation and interactive drag/resize controls.

**Architecture:** Single-file HTML/CSS/JS extension in `To-do.html`. Modal UI rendered dynamically on trigger, task time properties synced with `currentTasks` state and persisted via `saveCurrentDateData()`.

**Tech Stack:** Vanilla JavaScript (ES6+), Vanilla CSS3 (CSS Variables, Flexbox, Grid, Glassmorphism), HTML5.

## Global Constraints
- Target File: `To-do.html`
- Strict scoping: No external JS/CSS dependencies
- State synchronization: Update `currentTasks` and invoke `saveCurrentDateData()` on drag/resize

---

### Task 1: UI Trigger & Modal HTML/CSS Structure

**Files:**
- Modify: `To-do.html:920-960` (Header controls and Modal markup)
- Modify: `To-do.html:450-580` (Modal CSS styles)

**Interfaces:**
- Consumes: `.book-header-banner` DOM container
- Produces: `#gantt-modal-btn`, `#gantt-modal-overlay` elements

- [ ] **Step 1: Add Gantt View trigger button in header**

In `To-do.html` inside `.book-header-banner`:
```html
<button id="gantt-modal-btn" class="nav-btn gantt-btn" title="View Gantt Timeline">📊 Gantt View</button>
```

- [ ] **Step 2: Add Gantt Modal HTML container before `</body>`**

```html
<div id="gantt-modal-overlay" class="gantt-modal-overlay hidden">
  <div class="gantt-modal-card">
    <div class="gantt-modal-header">
      <div class="gantt-header-title">
        <h3>📊 Daily Task Timeline & Gantt Chart</h3>
        <span id="gantt-date-badge" class="gantt-date-badge"></span>
      </div>
      <div class="gantt-header-actions">
        <span id="gantt-progress-badge" class="gantt-progress-badge">0 / 0 Done</span>
        <button id="gantt-modal-close" class="gantt-close-btn">✕</button>
      </div>
    </div>
    <div id="gantt-grid-container" class="gantt-grid-container">
      <!-- Dynamically rendered Gantt rows -->
    </div>
  </div>
</div>
```

- [ ] **Step 3: Add CSS for Gantt Trigger Button & Modal Overlay**

In `<style>` section of `To-do.html`:
```css
.gantt-btn {
  background: rgba(139, 90, 43, 0.15);
  color: var(--accent-brown, #5c3a21);
  border: 1px solid rgba(139, 90, 43, 0.3);
  padding: 6px 14px;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}
.gantt-btn:hover {
  background: rgba(139, 90, 43, 0.25);
  transform: translateY(-1px);
}
.gantt-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.65);
  backdrop-filter: blur(8px);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  opacity: 1;
  transition: opacity 0.25s ease;
}
.gantt-modal-overlay.hidden {
  display: none;
  opacity: 0;
  pointer-events: none;
}
.gantt-modal-card {
  background: #fdfbf7;
  border-radius: 16px;
  width: 95%;
  max-width: 1050px;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 40px rgba(0,0,0,0.3);
  border: 1px solid rgba(139, 90, 43, 0.2);
  overflow: hidden;
}
.gantt-modal-header {
  padding: 16px 24px;
  background: #2b1b17;
  color: #fdfbf7;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.gantt-header-title h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}
.gantt-date-badge {
  font-size: 12px;
  color: #d97706;
  margin-left: 10px;
}
.gantt-close-btn {
  background: rgba(255,255,255,0.1);
  border: none;
  color: #fff;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 16px;
}
.gantt-grid-container {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}
```

- [ ] **Step 4: Commit UI markup and CSS**

```bash
git add To-do.html
git commit -m "feat: add Gantt View trigger button and modal overlay structure"
```

---

### Task 2: Gantt Chart Grid Rendering & Smart Time Allocation

**Files:**
- Modify: `To-do.html:1120-1300` (JS functions for Gantt rendering)

**Interfaces:**
- Consumes: `currentTasks`, `currentDate`
- Produces: `renderGanttChart()`, `openGanttModal()`, `closeGanttModal()`

- [ ] **Step 1: Implement `ensureTaskTimeSlots(tasks)` helper**

```javascript
function ensureTaskTimeSlots(tasks) {
  let startHour = 9;
  return tasks.map((task, idx) => {
    if (!task.startTime || !task.endTime) {
      const sH = String(startHour % 24).padStart(2, '0');
      const eH = String((startHour + 1) % 24).padStart(2, '0');
      task.startTime = `${sH}:00`;
      task.endTime = `${eH}:00`;
      startHour++;
    }
    return task;
  });
}
```

- [ ] **Step 2: Implement `renderGanttChart()`**

```javascript
function renderGanttChart() {
  const container = document.getElementById('gantt-grid-container');
  if (!container) return;

  const validTasks = currentTasks.filter(t => t.text.trim() !== '');
  ensureTaskTimeSlots(validTasks);

  const hours = ['8 AM', '9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM', '6 PM', '7 PM', '8 PM'];

  let html = `
    <div class="gantt-chart-table">
      <div class="gantt-header-row">
        <div class="gantt-task-col-header">Task Description</div>
        <div class="gantt-timeline-header">
          ${hours.map(h => `<div class="gantt-hour-tick">${h}</div>`).join('')}
        </div>
      </div>
      <div class="gantt-body">
  `;

  validTasks.forEach(task => {
    // Calculate start % and width % based on 8 AM (480 min) to 8 PM (1200 min) range (720 mins total)
    const [sH, sM] = (task.startTime || '09:00').split(':').map(Number);
    const [eH, eM] = (task.endTime || '10:00').split(':').map(Number);

    const startMins = sH * 60 + sM - 480; // 480 = 8:00 AM
    const endMins = eH * 60 + eM - 480;
    
    const leftPct = Math.max(0, Math.min(100, (startMins / 720) * 100));
    const widthPct = Math.max(2, Math.min(100 - leftPct, ((endMins - startMins) / 720) * 100));

    html += `
      <div class="gantt-row" data-id="${task.id}">
        <div class="gantt-task-name ${task.completed ? 'completed' : ''}">
          <input type="checkbox" ${task.completed ? 'checked' : ''} onchange="toggleTaskNotebook('${task.id}'); renderGanttChart();" />
          <span>${escapeHtml(task.text)}</span>
        </div>
        <div class="gantt-track">
          <div class="gantt-bar ${task.completed ? 'completed' : ''}" style="left: ${leftPct}%; width: ${widthPct}%;" data-id="${task.id}">
            <span class="gantt-bar-label">${task.startTime || '09:00'} - ${task.endTime || '10:00'}</span>
            <div class="gantt-resize-handle" data-id="${task.id}"></div>
          </div>
        </div>
      </div>
    `;
  });

  html += `</div></div>`;
  container.innerHTML = html;

  // Update badges
  const progressBadge = document.getElementById('gantt-progress-badge');
  const dateBadge = document.getElementById('gantt-date-badge');
  const completed = validTasks.filter(t => t.completed).length;
  if (progressBadge) progressBadge.textContent = `${completed} / ${validTasks.length} Done`;
  if (dateBadge) dateBadge.textContent = formatDateTitle(currentDate);
}
```

- [ ] **Step 3: Attach Modal Trigger & Close Event Listeners**

```javascript
function initGanttModalEvents() {
  const btn = document.getElementById('gantt-modal-btn');
  const modal = document.getElementById('gantt-modal-overlay');
  const closeBtn = document.getElementById('gantt-modal-close');

  if (btn && modal) {
    btn.addEventListener('click', () => {
      renderGanttChart();
      modal.classList.remove('hidden');
    });
  }
  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => {
      modal.classList.add('hidden');
    });
  }
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  }
}
```

- [ ] **Step 4: Commit Gantt rendering and event handlers**

```bash
git add To-do.html
git commit -m "feat: implement Gantt chart rendering and modal open/close controls"
```

---

### Task 3: Interactive Drag & Resize Functionality

**Files:**
- Modify: `To-do.html:1300-1420` (JS event handlers for mouse dragging/resizing)
- Modify: `To-do.html:580-680` (Gantt bar styles, track grid CSS, drag handles)

**Interfaces:**
- Consumes: `.gantt-bar`, `.gantt-resize-handle`
- Produces: `initGanttDragAndDrop()`

- [ ] **Step 1: Add Gantt CSS styles for Grid, Bars, and Handles**

```css
.gantt-chart-table {
  display: flex;
  flex-direction: column;
  width: 100%;
}
.gantt-header-row {
  display: flex;
  border-bottom: 2px solid rgba(139, 90, 43, 0.2);
  padding-bottom: 8px;
  font-weight: 700;
  color: var(--accent-brown, #5c3a21);
}
.gantt-task-col-header {
  width: 240px;
  flex-shrink: 0;
  padding-left: 8px;
}
.gantt-timeline-header {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(13, 1fr);
  text-align: center;
  font-size: 11px;
}
.gantt-row {
  display: flex;
  align-items: center;
  height: 44px;
  border-bottom: 1px dashed rgba(139, 90, 43, 0.15);
}
.gantt-task-name {
  width: 240px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-right: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gantt-task-name.completed span {
  text-decoration: line-through;
  opacity: 0.6;
}
.gantt-track {
  flex: 1;
  height: 100%;
  position: relative;
  background: rgba(139, 90, 43, 0.03);
}
.gantt-bar {
  position: absolute;
  top: 6px;
  bottom: 6px;
  background: linear-gradient(135deg, #d97706, #b45309);
  color: #fff;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  font-size: 11px;
  font-weight: 600;
  cursor: grab;
  user-select: none;
  box-shadow: 0 2px 6px rgba(0,0,0,0.15);
  transition: box-shadow 0.2s;
}
.gantt-bar.completed {
  background: linear-gradient(135deg, #059669, #047857);
}
.gantt-resize-handle {
  width: 8px;
  height: 100%;
  position: absolute;
  right: 0;
  top: 0;
  cursor: e-resize;
  background: rgba(255,255,255,0.3);
  border-top-right-radius: 6px;
  border-bottom-right-radius: 6px;
}
```

- [ ] **Step 2: Implement `initGanttDragAndDrop()` mouse drag/resize handler**

```javascript
function initGanttDragAndDrop() {
  const container = document.getElementById('gantt-grid-container');
  if (!container) return;

  let activeBar = null;
  let isResizing = false;
  let startX = 0;
  let initialLeft = 0;
  let initialWidth = 0;
  let trackWidth = 1;

  container.addEventListener('mousedown', (e) => {
    const handle = e.target.closest('.gantt-resize-handle');
    const bar = e.target.closest('.gantt-bar');
    if (!bar) return;

    const track = bar.closest('.gantt-track');
    if (!track) return;

    activeBar = bar;
    trackWidth = track.clientWidth;
    startX = e.clientX;
    initialLeft = parseFloat(bar.style.left) || 0;
    initialWidth = parseFloat(bar.style.width) || 0;
    isResizing = !!handle;

    activeBar.style.cursor = isResizing ? 'e-resize' : 'grabbing';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!activeBar) return;

    const deltaX = e.clientX - startX;
    const deltaPct = (deltaX / trackWidth) * 100;

    if (isResizing) {
      const newWidth = Math.max(2, Math.min(100 - initialLeft, initialWidth + deltaPct));
      activeBar.style.width = `${newWidth}%`;
    } else {
      const newLeft = Math.max(0, Math.min(100 - initialWidth, initialLeft + deltaPct));
      activeBar.style.left = `${newLeft}%`;
    }
  });

  document.addEventListener('mouseup', () => {
    if (!activeBar) return;

    const id = activeBar.getAttribute('data-id');
    const task = currentTasks.find(t => t.id === id);

    if (task) {
      const leftPct = parseFloat(activeBar.style.left) || 0;
      const widthPct = parseFloat(activeBar.style.width) || 0;

      // 720 minutes range (8 AM = 480m to 8 PM = 1200m)
      const startMins = 480 + Math.round((leftPct / 100) * 720 / 15) * 15;
      const endMins = Math.min(1200, startMins + Math.max(15, Math.round((widthPct / 100) * 720 / 15) * 15));

      const sH = String(Math.floor(startMins / 60)).padStart(2, '0');
      const sM = String(startMins % 60).padStart(2, '0');
      const eH = String(Math.floor(endMins / 60)).padStart(2, '0');
      const eM = String(endMins % 60).padStart(2, '0');

      task.startTime = `${sH}:${sM}`;
      task.endTime = `${eH}:${eM}`;

      saveCurrentDateData();
      renderGanttChart();
    }

    activeBar.style.cursor = 'grab';
    activeBar = null;
    isResizing = false;
  });
}
```

- [ ] **Step 3: Run Node validation test script**

```bash
node -e "const fs = require('fs'); const html = fs.readFileSync('To-do.html', 'utf8'); console.log('Contains Gantt logic:', html.includes('renderGanttChart'));"
```

- [ ] **Step 4: Commit interactive drag & resize implementation**

```bash
git add To-do.html
git commit -m "feat: implement interactive drag and duration resize for Gantt chart bars"
```
