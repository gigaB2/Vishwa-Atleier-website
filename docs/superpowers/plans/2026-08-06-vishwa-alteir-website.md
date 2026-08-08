# Vishwa Atelier Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a luxury single-page website for Vishwa Atelier featuring dark hero, dynamic process stepper, interactive lookbook, and PDF catalog download.

**Architecture:** Single page HTML5 app with modular vanilla CSS3 design system and vanilla ES6 JS controllers for media stepper, filtering, lightbox, and scrollspy.

**Tech Stack:** HTML5, CSS3, JavaScript (ES6+), Google Fonts (Cormorant Garamond & Plus Jakarta Sans).

## Global Constraints

- **Design Aesthetic:** Editorial Contrast (Dynamic Hybrid dark obsidian hero to warm silk cream body).
- **Typography:** Serif `Cormorant Garamond` for titles & Brand Mark; Sans-serif `Plus Jakarta Sans` for UI & body.
- **Media Asset Paths:** Must consume exact paths from `/assets/` and `/lookbooks/`.
- **Zero Heavy Build Dependencies:** Pure HTML5/CSS3/JS execution runnable directly in browser.

---

### Task 1: Design System & Styling Framework

**Files:**
- Create: `css/style.css`

**Interfaces:**
- Consumes: Google Fonts (`Cormorant Garamond`, `Plus Jakarta Sans`)
- Produces: CSS variable tokens, global reset, layout utilities, glassmorphism, responsive breakpoints, luxury component styles.

- [ ] **Step 1: Define CSS Variables & Global Typography Base**

```css
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap');

:root {
  --bg-dark-obsidian: #0E0F12;
  --bg-dark-card: #16181D;
  --text-dark-primary: #FAF8F5;
  --text-dark-secondary: #A0A5B1;

  --bg-light-cream: #FAF8F5;
  --bg-light-card: #FFFFFF;
  --text-light-primary: #1A1D20;
  --text-light-secondary: #5A606B;

  --accent-gold-primary: #C5A059;
  --accent-gold-hover: #D4AF37;
  --accent-gold-light: #F4E8C1;
  --accent-bronze: #8E733E;

  --border-dark: rgba(255, 255, 255, 0.1);
  --border-light: rgba(26, 29, 32, 0.08);

  --font-serif: 'Cormorant Garamond', Georgia, serif;
  --font-sans: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
  
  --shadow-luxury: 0 20px 40px -15px rgba(0, 0, 0, 0.07);
  --shadow-modal: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 16px;
  --radius-full: 9999px;
  --transition-smooth: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  scroll-behavior: smooth;
  font-family: var(--font-sans);
  color: var(--text-light-primary);
  background-color: var(--bg-light-cream);
  line-height: 1.6;
}

body {
  overflow-x: hidden;
}

h1, h2, h3, h4, .font-serif {
  font-family: var(--font-serif);
  font-weight: 600;
  line-height: 1.2;
}
```

- [ ] **Step 2: Add Component Styles (Header, Hero, Stepper, Grid, Modal, Footer)**
Add styles for sticky glassmorphic navbar, dark hero background, multi-step tabbed layout, filterable grid, lightbox modal, download card, and responsiveness.

- [ ] **Step 3: Verify CSS File Validity**
Run a syntax check or verify `css/style.css` exists.

---

### Task 2: Build HTML Single-Page Architecture

**Files:**
- Create: `index.html`

**Interfaces:**
- Consumes: `css/style.css`, media files in `assets/`, `lookbooks/`
- Produces: Complete semantic single-page structure (`#header`, `#hero`, `#process`, `#lookbook`, `#catalog`, `#story`, `#footer`, `#fabric-modal`).

- [ ] **Step 1: Create Main HTML Structure**
Create `index.html` with full semantic layout including:
- Sticky header with logo, navigation links, and CTA.
- Full-bleed hero video section with autoplay background video `assets/Final factory movie.mp4`.
- Section 3: Manufacturing Process 5-Stage Stepper with video and image frames.
- Section 4: Filterable Lookbook grid with fabric cards.
- Section 5: Catalog PDF download card targeting `assets/vishwa-alteir-catalog.pdf`.
- Section 6: Brand Story section.
- Section 7: Footer with compliance badges and inquiry form.
- Lightbox Modal dialog `#fabric-modal`.

- [ ] **Step 2: Verify HTML Structure**
Inspect `index.html` file to ensure all section IDs and data-attributes match.

---

### Task 3: Interactive JavaScript Application Logic

**Files:**
- Create: `js/main.js`

**Interfaces:**
- Consumes: DOM elements in `index.html`
- Produces: `switchTab()`, `filterLookbook()`, `openModal()`, `closeModal()`, sticky navbar scrollspy.

- [ ] **Step 1: Implement Main Interactive Logic**
Implement `js/main.js` covering:
1. `initProcessStepper()` — Tab switching for manufacturing steps, auto playing/pausing hidden HTML5 videos.
2. `initLookbookFilter()` — Category filter buttons for textile lookbook items.
3. `initFabricModal()` — Lightbox modal controller for fabric detail inspection.
4. `initNavbarScrollspy()` — Dynamic glassmorphism backdrop blur on scroll & active link indicator.
5. Smooth scrolling for internal anchor links.

- [ ] **Step 2: Verify JavaScript Execution**
Ensure `js/main.js` contains clean ES6 logic with no reference errors.

---

### Task 4: End-to-End Verification & Presentation

**Files:**
- Verify: `index.html`, `css/style.css`, `js/main.js`, `assets/airjet_weaving_machine.png`, `assets/vishwa-alteir-catalog.pdf`

- [ ] **Step 1: Run Local Server / File Check**
Verify file presence and local functionality.
- [ ] **Step 2: Create Walkthrough Summary**
Document walkthrough results.
