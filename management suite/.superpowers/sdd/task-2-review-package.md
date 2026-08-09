diff --git a/To-do.html b/To-do.html
index 52794e2..a166f79 100644
--- a/To-do.html
+++ b/To-do.html
@@ -213,11 +213,104 @@
       margin-bottom: 20px;
     }
 
-    .page-title {
-      font-size: 20px;
-      font-weight: 700;
-      letter-spacing: -0.5px;
-      text-transform: uppercase;
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
     }
   </style>
 </head>
@@ -266,5 +359,82 @@
     </div>
   </div>
 
+  <script>
+    let currentTasks = [];
+
+    function addTask(text) {
+      currentTasks.push({ id: 't_' + Date.now(), text: text, completed: false });
+      renderTasks(currentTasks);
+    }
+
+    function toggleTask(taskId) {
+      currentTasks = currentTasks.map(t => t.id === taskId ? { ...t, completed: !t.completed } : t);
+      renderTasks(currentTasks);
+    }
+
+    function deleteTask(taskId) {
+      currentTasks = currentTasks.filter(t => t.id !== taskId);
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
+      // Event listener for task input
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
+    function escapeHtml(str) {
+      return str.replace(/[&<>'"]/g, 
+        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
+      );
+    }
+
+    // Initial render on DOM load
+    window.addEventListener('DOMContentLoaded', () => {
+      renderTasks(currentTasks);
+    });
+  </script>
 </body>
 </html>
