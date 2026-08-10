diff --git a/To-do.html b/To-do.html
index 3608268..40fb71e 100644
--- a/To-do.html
+++ b/To-do.html
@@ -169,9 +169,9 @@
       height: 100%;
       background: var(--paper-cream);
       border-radius: 6px;
-      overflow: hidden;
       box-shadow: inset 0 0 20px rgba(0,0,0,0.08);
       position: relative;
+      transform-style: preserve-3d;
     }
 
     .page {
@@ -188,10 +188,12 @@
     .left-page {
       border-right: 1px solid rgba(0,0,0,0.1);
       box-shadow: inset -15px 0 25px -10px rgba(0,0,0,0.1);
+      border-radius: 6px 0 0 6px;
     }
 
     .right-page {
       box-shadow: inset 15px 0 25px -10px rgba(0,0,0,0.1);
+      border-radius: 0 6px 6px 0;
     }
 
     .page-number {
@@ -383,6 +385,85 @@
       color: var(--accent-brown);
       font-weight: 600;
     }
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
   </style>
 </head>
 <body>
@@ -431,20 +512,103 @@
   </div>
 
   <script>
+    const STORAGE_KEY = 'todo_book_planner_v1';
+    let currentDate = getTodayDateStr();
+    let isAnimating = false;
     let currentTasks = [];
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
 
     function addTask(text) {
       currentTasks.push({ id: 't_' + Date.now(), text: text, completed: false });
+      saveCurrentDateData();
       renderTasks(currentTasks);
     }
 
     function toggleTask(taskId) {
       currentTasks = currentTasks.map(t => t.id === taskId ? { ...t, completed: !t.completed } : t);
+      saveCurrentDateData();
       renderTasks(currentTasks);
     }
 
     function deleteTask(taskId) {
       currentTasks = currentTasks.filter(t => t.id !== taskId);
+      saveCurrentDateData();
       renderTasks(currentTasks);
     }
 
@@ -477,7 +641,6 @@
         </ul>
       `;
 
-      // Event listener for task input
       const input = document.getElementById('new-task-input');
       const btn = document.getElementById('add-task-btn');
       
@@ -496,11 +659,9 @@
       }
     }
 
-    let currentNotes = '';
-    let notesDebounceTimer = null;
-
     function saveNotes(notesText) {
       currentNotes = notesText;
+      saveCurrentDateData();
     }
 
     function renderNotes(notesText) {
@@ -525,6 +686,7 @@
 
         textarea.addEventListener('input', (e) => {
           const val = e.target.value;
+          currentNotes = val;
           if (statusBadge) {
             statusBadge.textContent = 'Saving...';
             statusBadge.classList.add('saving');
@@ -543,7 +705,124 @@
       }
     }
 
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
     function escapeHtml(str) {
+      if (!str) return '';
       return str.replace(/[&<>'"]/g, 
         tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
       );
@@ -551,9 +830,28 @@
 
     // Initial render on DOM load
     window.addEventListener('DOMContentLoaded', () => {
+      currentDate = getTodayDateStr();
+      const initialData = loadDateData(currentDate);
+      currentTasks = initialData.tasks;
+      currentNotes = initialData.notes;
+
+      updateDateDisplay();
       renderTasks(currentTasks);
       renderNotes(currentNotes);
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
     });
   </script>
 </body>
 </html>
+
