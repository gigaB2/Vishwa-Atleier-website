---
name: Vishwa Heritage
colors:
  surface: '#f9f9f9'
  surface-dim: '#dadada'
  surface-bright: '#f9f9f9'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f4f3f3'
  surface-container: '#eeeeee'
  surface-container-high: '#e8e8e8'
  surface-container-highest: '#e2e2e2'
  on-surface: '#1a1c1c'
  on-surface-variant: '#444748'
  inverse-surface: '#2f3131'
  inverse-on-surface: '#f1f1f1'
  outline: '#747878'
  outline-variant: '#c4c7c7'
  surface-tint: '#5f5e5e'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#1c1b1b'
  on-primary-container: '#858383'
  inverse-primary: '#c8c6c5'
  secondary: '#5f5e5b'
  on-secondary: '#ffffff'
  secondary-container: '#e5e2dd'
  on-secondary-container: '#656461'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#261900'
  on-tertiary-container: '#a17f3b'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e5e2e1'
  primary-fixed-dim: '#c8c6c5'
  on-primary-fixed: '#1c1b1b'
  on-primary-fixed-variant: '#474746'
  secondary-fixed: '#e5e2dd'
  secondary-fixed-dim: '#c9c6c2'
  on-secondary-fixed: '#1c1c19'
  on-secondary-fixed-variant: '#474743'
  tertiary-fixed: '#ffdea5'
  tertiary-fixed-dim: '#e9c176'
  on-tertiary-fixed: '#261900'
  on-tertiary-fixed-variant: '#5d4201'
  background: '#f9f9f9'
  on-background: '#1a1c1c'
  surface-variant: '#e2e2e2'
typography:
  display-lg:
    fontFamily: Bodoni Moda
    fontSize: 72px
    fontWeight: '400'
    lineHeight: 80px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Bodoni Moda
    fontSize: 48px
    fontWeight: '400'
    lineHeight: 56px
  headline-lg-mobile:
    fontFamily: Bodoni Moda
    fontSize: 32px
    fontWeight: '400'
    lineHeight: 40px
  headline-md:
    fontFamily: Bodoni Moda
    fontSize: 32px
    fontWeight: '400'
    lineHeight: 40px
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-caps:
    fontFamily: Hanken Grotesk
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.1em
spacing:
  unit: 8px
  container-max: 1440px
  gutter: 24px
  margin-mobile: 20px
  margin-desktop: 64px
---

## Brand & Style

The design system is rooted in the concepts of **Heritage, Craftsmanship, and Timeless Luxury**. It targets a high-end demographic that values the tactile quality of premium textiles and the precision of expert tailoring. 

The visual style is a blend of **High-End Editorial Minimalism** and **Sophisticated Modernism**. It prioritizes extreme whitespace to allow product photography—the "fabrics"—to breathe. The interface acts as a quiet, museum-like gallery where the content is the primary focus. Layouts are intentional and asymmetric, mimicking the composition of luxury fashion lookbooks. 

The emotional response should be one of calm, exclusivity, and unwavering quality. There is no visual "noise"; every line, character, and margin is deliberate.

## Colors

The palette is designed to reflect the raw materials and refined outputs of textile manufacturing.

*   **Primary (Deep Charcoal - #1A1A1A):** Used for primary typography and structural elements to provide a grounded, authoritative weight.
*   **Secondary (Soft Cream - #F5F2ED):** The primary background color. It is warmer and more sophisticated than pure white, evoking the feel of unbleached silk or high-grade parchment.
*   **Tertiary (Subtle Gold - #C5A059):** A muted metallic used sparingly for "thread-like" accents, active states, and premium callouts.
*   **Neutral (Champagne/Grey - #E5E5E5):** Used for thin borders, subtle dividers, and secondary backgrounds to create soft depth.

## Typography

This design system utilizes a high-contrast typographic pairing to establish a clear hierarchy of luxury.

*   **Headlines:** *Bodoni Moda* provides a classical, editorial feel with its vertical stress and sharp serifs. It should be used for all major section titles and product names.
*   **Body & Navigation:** *Hanken Grotesk* offers a precise, modern counterpoint. Its clean geometry ensures legibility for technical textile descriptions and specifications.
*   **Editorial Spacing:** Large display sizes should use tight letter-spacing, while functional labels (caps) should have generous tracking to evoke a premium brand feel.

## Layout & Spacing

The layout philosophy follows a **Modular Editorial Grid**.

1.  **Grid Model:** A 12-column grid for desktop with wide 64px margins to create a sense of enclosure and exclusivity. 
2.  **Rhythm:** Spacing follows an 8px base unit, but emphasizes "Large Scale" jumps (e.g., 80px or 120px between sections) to maintain the minimalist aesthetic.
3.  **Imagery:** Use full-bleed sections or "broken-grid" image placements where fabric textures overlap white space or secondary background blocks.
4.  **Mobile:** Shift to a 4-column grid with 20px margins. High-contrast headlines should scale down to maintain readability while keeping their dramatic impact.

## Elevation & Depth

To maintain the "flat-luxury" textile aesthetic, this design system avoids heavy shadows or industrial depth.

*   **Tonal Layers:** Depth is created through color blocking (e.g., a Soft Cream card on a Deep Charcoal background).
*   **Low-Contrast Outlines:** Instead of shadows, use 0.5px or 1px borders in `Neutral` or `Tertiary` colors to define boundaries.
*   **Glassmorphism (Sparse):** Use a very subtle backdrop blur (4px) with high transparency (10-20%) only for floating navigation bars to ensure they don't obscure the fabric textures underneath.
*   **Hover States:** Elevate elements using a slight shift in background tone or a subtle scale-up (1.02x) rather than a shadow.

## Shapes

The shape language is **Strictly Geometric and Sharp**. 

*   All buttons, input fields, and image containers must have **0px corner radius**. 
*   Sharp corners communicate precision, architectural strength, and the "cut" of high-end tailoring. 
*   Avoid circles unless used for functional iconography; even then, consider square-framed icons for brand consistency.

## Components

*   **Buttons:** Primary buttons are solid Deep Charcoal with white text, 0px radius. Secondary buttons use a 1px border with the `label-caps` typography style.
*   **Input Fields:** Minimalist "Underline" style or a very thin 1px border. Focus states are indicated by the `Tertiary` gold color on the bottom border only.
*   **Cards:** Borderless with background color shifts (`Secondary` on a white background). Images within cards should always be the focal point, using a 3:4 aspect ratio common in fashion photography.
*   **Chips/Tags:** Small, rectangular boxes with the `label-caps` font style, using a `Neutral` background and primary text.
*   **Lists:** High-density text lists for specifications should be separated by thin 0.5px horizontal rules that span the full width of the container.
*   **Navigation:** A minimalist top bar with centered branding and `label-caps` links. The active state is a simple underline in the `Tertiary` gold.