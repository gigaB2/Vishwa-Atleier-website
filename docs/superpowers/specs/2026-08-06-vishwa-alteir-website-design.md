# Vishwa Atelier — Luxury Textile Manufacturing Single-Page Website Design Spec

**Date:** 2026-08-06  
**Status:** Approved by User  
**Brand:** Vishwa Atelier (Vishwa Fashions — 40-Year Heritage Textile Manufacturer)  

---

## 1. Executive Summary & Brand Identity

Vishwa Atelier is an elite luxury textile manufacturing brand backed by the Vishwa Group of Companies with a 40-year legacy in master weaving, saree manufacturing, and textile innovation.

This project delivers a full, high-end, responsive single-page website that showcases Vishwa Atelier’s craftsmanship, master weaving technology (Jacquard Rapier & Airjet looms), interactive textile lookbook, and high-resolution catalog download capabilities.

---

## 2. Design System & Aesthetics

### Theme: Editorial Contrast (Dynamic Hybrid)
- **Hero Section:** Dramatic, obsidian-toned luxury theme (`#0E0F12`) with ambient background video, subtle gold glow, and high-contrast typography.
- **Body & Content Sections:** Transition seamlessly into warm silk cream (`#FAF8F5`) and deep slate (`#1A1D20`) with champagne gold accents (`#C5A059`).

### Color Palette Tokens
```css
:root {
  /* Dark Luxury (Hero & Accents) */
  --bg-dark-obsidian: #0E0F12;
  --bg-dark-card: #16181D;
  --text-dark-primary: #FAF8F5;
  --text-dark-secondary: #A0A5B1;

  /* Light Editorial (Process & Lookbook) */
  --bg-light-cream: #FAF8F5;
  --bg-light-card: #FFFFFF;
  --text-light-primary: #1A1D20;
  --text-light-secondary: #5A606B;

  /* Metallic Accents */
  --accent-gold-primary: #C5A059;
  --accent-gold-hover: #D4AF37;
  --accent-gold-light: #F4E8C1;
  --accent-bronze: #8E733E;

  /* Borders & Glassmorphism */
  --border-dark: rgba(255, 255, 255, 0.1);
  --border-light: rgba(26, 29, 32, 0.08);
  --glass-dark: rgba(14, 15, 18, 0.75);
  --glass-light: rgba(250, 248, 245, 0.85);
  --shadow-luxury: 0 20px 40px -15px rgba(0, 0, 0, 0.07);
}
```

### Typography
- **Serif Headings & Brand Mark:** `Cormorant Garamond` (Google Fonts, weights 400, 500, 600, 700).
- **Body & Interactive UI:** `Plus Jakarta Sans` (Google Fonts, weights 300, 400, 500, 600).

---

## 3. Page Architecture & Section Specifications

### 1. Header & Navigation Bar (Sticky Glassmorphic)
- Sticky top navbar with dynamic background blur on scroll (>50px).
- **Brand Logo:** `VISHWA ATELIER` with loom icon mark.
- **Nav Links:** `Manufacturing Process`, `Lookbook Gallery`, `Our Legacy`, `Download Catalog`, `Contact Us`.
- **CTA Button:** High-contrast `Download Catalog` button.
- **Mobile Drawer:** Touch-friendly slide-over mobile navigation.

### 2. Hero Section (Cinematic Noir)
- **Background Video:** Autoplay muted looping video using `/assets/Final factory movie.mp4` with a dark radial vignette overlay.
- **Headline:** *"Unveiling the Artistry of Indian Luxury — From Our Looms to Your Wardrobe."*
- **Slogan:** *"40 Years of Master Weaving, Modern Precision & Craftsmanship Excellence."*
- **Dual CTAs:** 
  - `Explore Our Craft` (Smooth scroll to `#process`)
  - `Download 2024 Catalog` (Smooth scroll to `#catalog`)
- **Stats Bar:** `40+ Years Legacy` | `3 Generations` | `Jacquard & Airjet` | `Global Supply`.

### 3. Complete Manufacturing Process Showcase (The Loom Narrative Stepper)
5-Stage interactive media stepper with tab switching, video/photo frames, and technical breakdown:
1. **Fibers & Raw Materials:** Raw silk, viscose yarn (`assets/Viscose yarn.JPG`), polyester, dyed yarn (`assets/died polyester yarn.JPG`).
2. **Yarn Preparatory:** Winding, warping preparation video (`assets/Yarm preparatory movie.mp4`) & high-res closeups (`assets/yarn preparatory 2.JPG`).
3. **Sectional Warping:** Precision beam warping video (`assets/Sectional warping movie.mp4`) & yarn inspection (`assets/Yarn inspection.JPG`).
4. **Jacquard Rapier & Airjet Weaving:** High-speed Jacquard Rapier looms (`assets/Jacquard rapier.JPG`) & Airjet weaving machine (`assets/airjet_weaving_machine.png`).
5. **Finishing & Quality Control:** Fabric stabilization video (`assets/multiple clip stabilize_1_2.mp4`), inspection, and packaging.

### 4. Interactive Lookbook & Textile Gallery
- **Filter Pills:** `All Collections`, `Luxury Silk Sarees`, `Jacquard Brocades`, `Organza & Sheers`, `Sustainable Blends`.
- **Gallery Grid:** High-res textile cards showcasing woven patterns, thread work, and saree collection previews from `lookbooks/Lookbook 1 (AVF)` and `lookbooks/Lookbook 2 (VK)`.
- **Quick-View Lightbox Modal:** Full-screen modal on card click displaying:
  - Fabric Texture Closeup Image
  - Title & Collection Name
  - Weave Density (e.g., 140 PPI / Jacquard Weave)
  - Composition (e.g., Pure Mulberry Silk & Metallic Zari)
  - GSM / Fabric Width (e.g., 120 GSM, 44 Inches)
  - `Request Sample / Inquire` CTA.

### 5. Catalog & Resources Download Module
- **Preview Card:** Visual preview of Vishwa Atelier 2024 Collection Catalog.
- **Metadata Card:** `Format: PDF` | `Resolution: High-Res Print` | `File Size: ~13.6 MB` | `Page Count: 67`.
- **Download CTA:** Direct download link targeting `/assets/vishwa-alteir-catalog.pdf`.

### 6. Brand Story & Footer
- **Our Story:** 3 generations of master craftsmanship, 40-year legacy under Vishwa Group of Companies.
- **Footer Components:** ISO/OEKO-TEX compliance placeholders, directory navigation, quick contact form, social links, copyright.

---

## 4. Assets & Technical Requirements

### New / Generated Assets
1. `assets/airjet_weaving_machine.png`: Generated high-res photorealistic airjet weaving machine image.
2. `assets/vishwa-alteir-catalog.pdf`: Copied from `lookbooks/Lookbook 1 (AVF)/Lookbook_1_Catalog.pdf` (~13.6 MB).

### Frontend Code Assets
- `index.html`: Main semantic single-page web app.
- `css/style.css`: Clean vanilla CSS3 with variables, grid, flex, animations, media queries.
- `js/main.js`: Stepper tab logic, lookbook filter, modal lightbox, video autoplay management, scrollspy.

---

## 5. Verification Plan

1. **Asset Integrity:** Verify `assets/airjet_weaving_machine.png` and `assets/vishwa-alteir-catalog.pdf` exist.
2. **Browser Execution & Layout:** Test sticky navbar blur, hero video loop, process tab transitions, lookbook filter transitions, and lightbox modal behavior.
3. **Download Links:** Confirm `Download Catalog` button triggers `/assets/vishwa-alteir-catalog.pdf` download.
4. **Responsiveness:** Test viewport sizes (Desktop >1024px, Tablet 768px-1024px, Mobile <768px).
