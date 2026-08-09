diff --git a/To-do.html b/To-do.html
index a166f79..3608268 100644
--- a/To-do.html
+++ b/To-do.html
@@ -312,6 +312,77 @@
       font-style: italic;
       font-size: 14px;
     }
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
   </style>
 </head>
 <body>
@@ -425,6 +496,53 @@
       }
     }
 
+    let currentNotes = '';
+    let notesDebounceTimer = null;
+
+    function saveNotes(notesText) {
+      currentNotes = notesText;
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
     function escapeHtml(str) {
       return str.replace(/[&<>'"]/g, 
         tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
@@ -434,6 +552,7 @@
     // Initial render on DOM load
     window.addEventListener('DOMContentLoaded', () => {
       renderTasks(currentTasks);
+      renderNotes(currentNotes);
     });
   </script>
 </body>
