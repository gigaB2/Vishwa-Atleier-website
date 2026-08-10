diff --git a/To-do.html b/To-do.html
new file mode 100644
index 0000000..52794e2
--- /dev/null
+++ b/To-do.html
@@ -0,0 +1,270 @@
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
+      overflow: hidden;
+      box-shadow: inset 0 0 20px rgba(0,0,0,0.08);
+      position: relative;
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
+    }
+
+    .right-page {
+      box-shadow: inset 15px 0 25px -10px rgba(0,0,0,0.1);
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
+    .page-title {
+      font-size: 20px;
+      font-weight: 700;
+      letter-spacing: -0.5px;
+      text-transform: uppercase;
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
+</body>
+</html>
