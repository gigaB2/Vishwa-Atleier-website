### Task 2: Actionable Task List System (Left Page)

**Files:**
- Modify: `To-do.html`

**Interfaces:**
- Consumes: `#left-page-content`, `#task-counter-badge`, `#tasks-container`
- Produces: Interactive task input field, task creation, custom styled checkboxes, completion strikethrough, task deletion, and progress updates.

**Task Instructions & Code:**
1. Modify `To-do.html` to add CSS component styles for task list (`.task-input-wrapper`, `.task-input`, `.add-task-btn`, `.task-list`, `.task-item`, `.task-checkbox`, `.task-text`, `.delete-task-btn`, `.empty-state`).
2. Add JavaScript logic to render tasks inside `#tasks-container`:
   - Function `renderTasks(tasks)`: Renders input box, add button, and task list.
   - Calculates total vs completed tasks and updates `#task-counter-badge` text (e.g. `2 / 5 Done`).
   - Escapes HTML strings safely to prevent XSS.
   - Attach event handlers for task addition (click on button + `Enter` key on input), checkbox toggling, and task deletion.
3. Verify task input, checking off tasks with strikethrough styling, deleting tasks, and counter updates.
4. Commit with message: `git add To-do.html && git commit -m "feat: implement Left Page daily tasks component with interactive checkboxes and state management"`
