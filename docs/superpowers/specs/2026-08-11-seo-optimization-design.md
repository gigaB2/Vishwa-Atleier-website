# SEO Optimization Design: Ranking "Vishwa" & "Vishwa Atelier"

## Overview
This document specifies the technical SEO enhancements for `https://vishwaatelier.com` to achieve top Google search rankings for the primary brand search query **"Vishwa"**, as well as **"Vishwa Atelier"**, **"Vishwa Fashions"**, and related luxury textile manufacturing keywords in Surat, India.

## Key Targets
- **Primary Brand Keyword**: `Vishwa`
- **Secondary Brand Keywords**: `Vishwa Atelier`, `Vishwa Fashions`, `Vishwa Textiles`, `Vishwa Group`
- **Industry Keywords**: `Luxury Textile Manufacturer`, `Jacquard Rapier Looms`, `Airjet Looms`, `Surat Textile Mill`, `Master Weaving India`

---

## 1. On-Page HTML Meta & Heading Enhancements

### Title & Meta Tags (`index.html`)
- **Document Title**: `<title>Vishwa | Vishwa Atelier Luxury Textile Manufacturer & Looms Surat</title>`
- **Meta Description**: `<meta name="description" content="Vishwa (Vishwa Atelier) is India's premier luxury textile manufacturer with a 40-year legacy in Jacquard Rapier & Airjet looms, high-resolution sarees, and bespoke fabrics in Surat, Gujarat." />`
- **Meta Keywords**: `<meta name="keywords" content="Vishwa, Vishwa Atelier, Vishwa Fashions, Vishwa Textiles, Vishwa Surat, luxury textile manufacturer, Jacquard rapier looms, airjet looms, saree manufacturing Surat" />`
- **Robots Tag**: `<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />`
- **GEO Position Tags**:
  - `geo.region`: `IN-GJ`
  - `geo.placename`: `Surat`
  - `geo.position`: `21.0847;72.8804`
  - `ICBM`: `21.0847, 72.8804`

### Open Graph & Twitter Cards
- `og:title`: `Vishwa | Master Luxury Textile Manufacturer & Atelier`
- `og:site_name`: `Vishwa (Vishwa Atelier)`
- `og:description`: `Vishwa Atelier is a premier luxury textile manufacturer with a 40-year legacy in Jacquard Rapier & Airjet looms in Surat, Gujarat.`
- `twitter:title`: `Vishwa | Master Luxury Textile Manufacturer`

---

## 2. Rich Schema.org JSON-LD Structured Data

### Schema Entities (`index.html`)
1. **`WebSite` Schema**:
   - `name`: `"Vishwa"`
   - `alternateName`: `["Vishwa Atelier", "Vishwa Fashions", "Vishwa Group"]`
   - `url`: `"https://vishwaatelier.com"`
2. **`Organization` / `LocalBusiness` / `ManufacturingBusiness` Schema**:
   - `name`: `"Vishwa"`
   - `alternateName`: `["Vishwa Atelier", "Vishwa Fashions Pvt. Ltd.", "Vishwa Fab Weave", "Vishwa Group"]`
   - `legalName`: `"Vishwa Fashions Pvt. Ltd."`
   - `url`: `"https://vishwaatelier.com"`
   - `logo`: `"https://vishwaatelier.com/assets/Jacquard%20rapier.webp"`
   - `telephone`: `"+919313772824"`
   - `email`: `"vishwa@vishwafashions.com"`
   - `address`:
     - `streetAddress`: `"Plot No: 7414/2, Road No: 67, GIDC Sachin"`
     - `addressLocality`: `"Surat"`
     - `addressRegion`: `"Gujarat"`
     - `postalCode`: `"394230"`
     - `addressCountry`: `"IN"`
   - `geo`: `{"@type": "GeoCoordinates", "latitude": 21.0847, "longitude": 72.8804}`
   - `contactPoint`: Multi-line contacts for Vishwa Sheth, Rajiv Sheth, Manisha Sheth.
   - `vatID`: `"24ACIPS3584M1ZZ"`
3. **`BreadcrumbList` Schema**:
   - Item 1: `Home` (`https://vishwaatelier.com/`)
   - Item 2: `Lookbooks` (`https://vishwaatelier.com/#collections`)
   - Item 3: `Contact` (`https://vishwaatelier.com/#footer`)

---

## 3. Image Alt Text & Asset SEO
- Audit image `alt` attributes on hero and lookbook sections to ensure descriptive, brand-keyword-rich text (e.g. `alt="Vishwa Atelier Jacquard Rapier Loom Facility Surat"`).

---

## 4. Off-Page & Google Search Console Blueprint
- Create `docs/SEO_Action_Guide.md` providing step-by-step instructions for:
  1. Google Search Console sitemap submission.
  2. Google Business Profile setup for "Vishwa (Vishwa Atelier)".
  3. External brand authority signals & Bing Webmaster registration.
