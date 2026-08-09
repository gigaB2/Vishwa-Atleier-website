### Task 3: Ruled Journal & Notes System (Right Page)

**Files:**
- Modify: `To-do.html`

**Interfaces:**
- Consumes: `#right-page-content`, `#notes-container`, `#save-status-badge`
- Produces: Ruled notebook textarea, debounced auto-saving on typing, status indicator updates.

**Task Instructions & Code:**
1. Modify `To-do.html` to add CSS component styles for lined notebook (`.notes-wrapper`, `.notebook-textarea`, `.notes-margin-line`).
   - `.notebook-textarea` uses `repeating-linear-gradient` with `transparent 27px, var(--line-blue) 28px` for notebook lines.
   - Font style: `var(--font-hand), var(--font-ui)` for realistic handwritten journal notes.
2. Add JavaScript logic to render notes inside `#notes-container`:
   - Function `renderNotes(notesText)`: Renders textarea and margin line.
   - Attach debounced `input` event handler (300ms) to textarea that updates `#save-status-badge` text ("Saving..." -> "Saved ✓") and calls notes save function.
3. Verify notebook rendering, typing notes, and status badge transition.
4. Commit with message: `git add To-do.html && git commit -m "feat: implement Right Page ruled notebook notes component with debounced auto-saving"`
