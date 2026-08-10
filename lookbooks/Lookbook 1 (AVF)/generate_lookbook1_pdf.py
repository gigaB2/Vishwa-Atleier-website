import os
import io
import json
import re
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
from PIL import Image as PILImage

# Page dimensions (A4 portrait in points)
PAGE_WIDTH = 595.2755737304688
PAGE_HEIGHT = 841.8897705078125

def to_rl_y(y):
    return PAGE_HEIGHT - y

def draw_line(canv, x1, y1, x2, y2, color, width=0.75):
    canv.saveState()
    canv.setStrokeColor(HexColor(color))
    canv.setLineWidth(width)
    canv.line(x1, to_rl_y(y1), x2, to_rl_y(y2))
    canv.restoreState()

def draw_rect(canv, x1, y1, x2, y2, fill_color=None, stroke_color=None, stroke_width=0.75, radius=0):
    canv.saveState()
    if fill_color:
        canv.setFillColor(HexColor(fill_color))
    if stroke_color:
        canv.setStrokeColor(HexColor(stroke_color))
        canv.setLineWidth(stroke_width)
    
    width = x2 - x1
    height = y2 - y1
    if radius > 0:
        canv.roundRect(x1, to_rl_y(y2), width, height, radius, fill=1 if fill_color else 0, stroke=1 if stroke_color else 0)
    else:
        canv.rect(x1, to_rl_y(y2), width, height, fill=1 if fill_color else 0, stroke=1 if stroke_color else 0)
    canv.restoreState()

def draw_bento_full_cover(canv, img_path, x1, y1, x2, y2, radius=4):
    """
    Draws an image filling 100% of the Bento Card container edge-to-edge.
    Preserves 100% of vertical height so top and bottom are never cut off.
    """
    card_w = int(round(x2 - x1))
    card_h = int(round(y2 - y1))

    if not os.path.exists(img_path):
        draw_rect(canv, x1, y1, x2, y2, fill_color="#F4F1EA", stroke_color="#DCD5C9", radius=radius)
        canv.saveState()
        canv.setFillColor(HexColor("#B85C38"))
        canv.setFont("Helvetica-Bold", 8)
        canv.drawCentredString((x1 + x2) / 2, to_rl_y((y1 + y2) / 2), "No Photo")
        canv.restoreState()
        return

    try:
        with PILImage.open(img_path) as img:
            if img.mode != 'RGB':
                img = img.convert('RGB')
            
            img_w, img_h = img.size
            img_ratio = img_w / img_h
            card_ratio = card_w / card_h
            
            if img_ratio >= card_ratio:
                # Image is wider than card slot -> crop left/right, keep 100% top/bottom height
                new_w = int(img_h * card_ratio)
                left = (img_w - new_w) // 2
                crop_box = (left, 0, left + new_w, img_h)
            else:
                # Image is taller than card slot -> top-aligned crop to preserve head/face & top drape
                new_h = int(img_w / card_ratio)
                crop_box = (0, 0, img_w, new_h)
                
            cropped_img = img.crop(crop_box)
            
            # Downsample for fast rendering & compact PDF file size (<15MB)
            max_dim = max(card_w * 2, card_h * 2, 750)
            cropped_img.thumbnail((max_dim, max_dim), PILImage.Resampling.LANCZOS)
            
            buf = io.BytesIO()
            cropped_img.save(buf, format='JPEG', quality=68, optimize=True)
            buf.seek(0)
            img_reader = ImageReader(buf)
            
            canv.saveState()
            # Draw Container background & border
            canv.setFillColor(HexColor("#F4F1EA"))
            canv.setStrokeColor(HexColor("#DCD5C9"))
            canv.setLineWidth(0.75)
            canv.roundRect(x1, to_rl_y(y2), card_w, card_h, radius, fill=1, stroke=1)
            
            # Clip image path to rounded card
            p = canv.beginPath()
            p.roundRect(x1, to_rl_y(y2), card_w, card_h, radius)
            canv.clipPath(p, stroke=0)
            
            canv.drawImage(img_reader, x1, to_rl_y(y2), width=card_w, height=card_h)
            canv.restoreState()
    except Exception as e:
        print(f"Error loading image {img_path}: {e}")
        draw_rect(canv, x1, y1, x2, y2, fill_color="#F4F1EA", stroke_color="#DCD5C9", radius=radius)

def generate_catalog():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    catalog_js_path = os.path.join(base_dir, "catalog_data.js")
    pdf_path = os.path.join(base_dir, "Lookbook_1_Catalog.pdf")
    
    with open(catalog_js_path, "r", encoding="utf-8") as f:
        js_content = f.read()
    
    json_match = re.search(r'const\s+CATALOG_DATA\s*=\s*(\[[\s\S]*?\]);', js_content)
    if not json_match:
        raise ValueError("Could not find CATALOG_DATA array in catalog_data.js")
    
    catalog_data = json.loads(json_match.group(1))
    
    product_pages = []
    for item in catalog_data:
        imgs = []
        for img_rel in item.get("images", []):
            img_full = os.path.join(base_dir, "collection", img_rel)
            if os.path.exists(img_full):
                imgs.append(img_full)
            else:
                alt_rel = img_rel.replace('/', '\\')
                img_full_alt = os.path.join(base_dir, "collection", alt_rel)
                if os.path.exists(img_full_alt):
                    imgs.append(img_full_alt)
        
        c_name = item["name"]
        product_pages.append({
            "id": item["id"],
            "name": c_name,
            "sku": item["sku"],
            "fabric": item["fabric"],
            "type": item["type"],
            "tag": item["tag"],
            "notes": item.get("notes", ""),
            "images": imgs
        })
    
    total_pages = 2 + len(product_pages) + 1  # Cover + Directory + 51 products + Thank you page = 54
    
    c = canvas.Canvas(pdf_path, pagesize=(PAGE_WIDTH, PAGE_HEIGHT))
    c.setTitle("AVF Luxury Collection - Lookbook Catalog 1")
    c.setAuthor("AVF Textile House")
    
    # ==========================================
    # 1. COVER PAGE (Dark Slate & Gold Luxury Frame)
    # ==========================================
    draw_rect(c, 0, 0, PAGE_WIDTH, PAGE_HEIGHT, fill_color="#0D1117")
    
    # Outer & Inner Gold Borders
    draw_rect(c, 24.0, 24.0, PAGE_WIDTH - 24.0, PAGE_HEIGHT - 24.0, stroke_color="#C5A059", stroke_width=1.2)
    draw_rect(c, 28.0, 28.0, PAGE_WIDTH - 28.0, PAGE_HEIGHT - 28.0, stroke_color="#C5A059", stroke_width=0.6)
    
    c.saveState()
    c.setFont("Helvetica-Bold", 26)
    c.setFillColor(HexColor("#FFFFFF"))
    c.drawCentredString(PAGE_WIDTH / 2, to_rl_y(210), "AVF LUXURY COLLECTION")
    
    c.setFont("Helvetica", 13)
    c.setFillColor(HexColor("#C5A059"))
    c.drawCentredString(PAGE_WIDTH / 2, to_rl_y(248), "PHOTOSHOOT 1 • DESIGN CATALOGUE")
    c.restoreState()
    
    draw_line(c, 160, 275, PAGE_WIDTH - 160, 275, color="#C5A059", width=0.75)
    
    c.saveState()
    c.setFont("Helvetica-Bold", 10)
    c.setFillColor(HexColor("#94A3B8"))
    c.drawCentredString(PAGE_WIDTH / 2, to_rl_y(333), f"{len(product_pages)} EXCLUSIVE SAREE DESIGNS")
    
    c.setFont("Helvetica", 10)
    c.setFillColor(HexColor("#94A3B8"))
    c.drawCentredString(PAGE_WIDTH / 2, to_rl_y(355), "Banarasi • Jamdani • Kanjivaram • Cut Work • Jangla • Shikargadh")
    c.restoreState()
    
    draw_line(c, 200, 480, PAGE_WIDTH - 200, 480, color="#334155", width=0.5)
    
    c.saveState()
    c.setFont("Helvetica", 8)
    c.setFillColor(HexColor("#64748B"))
    c.drawCentredString(PAGE_WIDTH / 2, to_rl_y(510), "HIGH DEFINITION COMMERCIAL CATALOGUE")
    
    c.setFont("Helvetica-Bold", 8)
    c.setFillColor(HexColor("#C5A059"))
    c.drawCentredString(PAGE_WIDTH / 2, to_rl_y(530), "Volume 1.0 • 2026 Edition")
    c.restoreState()
    
    c.showPage()
    
    # ==========================================
    # 2. COLLECTION DIRECTORY (Page 2 - 2 Columns)
    # ==========================================
    c.saveState()
    c.setFont("Helvetica-Bold", 8.0)
    c.setFillColor(HexColor("#12161A"))
    c.drawString(36.0, to_rl_y(21.4), "AVF LUXURY COLLECTION")
    c.setFont("Helvetica", 8.0)
    c.setFillColor(HexColor("#64748B"))
    c.drawRightString(PAGE_WIDTH - 36.0, to_rl_y(21.4), "PHOTOSHOOT 1 • CATALOG")
    c.restoreState()
    
    draw_line(c, 36.0, 31.0, PAGE_WIDTH - 36.0, 31.0, color="#DCD5C9", width=0.75)
    
    c.saveState()
    c.setFont("Helvetica-Bold", 18.0)
    c.setFillColor(HexColor("#12161A"))
    c.drawString(42.0, to_rl_y(65.0), "COLLECTION DIRECTORY")
    c.setFont("Helvetica", 8.5)
    c.setFillColor(HexColor("#64748B"))
    c.drawString(42.0, to_rl_y(83.0), f"Complete index of all {len(product_pages)} designs included in Photoshoot 1")
    c.restoreState()
    
    # Header bar backgrounds for 2 columns
    draw_rect(c, 42.0, 102.0, 286.0, 118.0, fill_color="#12161A")
    draw_rect(c, 298.0, 102.0, 553.0, 118.0, fill_color="#12161A")
    
    # Header text
    c.saveState()
    c.setFont("Helvetica-Bold", 6.5)
    c.setFillColor(HexColor("#FFFFFF"))
    
    # Col 1 Header
    c.drawString(47.6, to_rl_y(113.0), "#")
    c.drawString(67.6, to_rl_y(113.0), "DESIGN NAME")
    c.drawString(172.6, to_rl_y(113.0), "SKU")
    c.drawString(217.6, to_rl_y(113.0), "WEAVE TYPE")
    c.drawRightString(282.0, to_rl_y(113.0), "PG")
    
    # Col 2 Header
    c.drawString(304.0, to_rl_y(113.0), "#")
    c.drawString(323.6, to_rl_y(113.0), "DESIGN NAME")
    c.drawString(428.6, to_rl_y(113.0), "SKU")
    c.drawString(473.6, to_rl_y(113.0), "WEAVE TYPE")
    c.drawRightString(541.6, to_rl_y(113.0), "PG")
    c.restoreState()
    
    # Data Rows
    start_y = 127.0
    row_h = 10.2
    
    for idx, item in enumerate(product_pages):
        col = 0 if idx < 26 else 1
        row = idx if idx < 26 else (idx - 26)
        
        y = start_y + (row * row_h)
        pg_num = 3 + idx
        
        x_num = 48.0 if col == 0 else 304.0
        x_name = 67.6 if col == 0 else 323.6
        x_sku = 172.6 if col == 0 else 428.6
        x_weave = 217.6 if col == 0 else 473.6
        x_pg = 282.0 if col == 0 else 541.6
        
        c.saveState()
        # Item Number (#)
        c.setFont("Helvetica-Bold", 6.5)
        c.setFillColor(HexColor("#C5A059"))
        c.drawString(x_num, to_rl_y(y), f"{item['id']:02d}")
        
        # Design Name
        c.setFont("Helvetica-Bold", 7.0)
        c.setFillColor(HexColor("#1E293B"))
        name_str = item['name']
        if len(name_str) > 22:
            name_str = name_str[:20] + ".."
        c.drawString(x_name, to_rl_y(y), name_str)
        
        # SKU
        c.setFont("Helvetica", 6.5)
        c.setFillColor(HexColor("#475569"))
        c.drawString(x_sku, to_rl_y(y), item['sku'])
        
        # Weave Type
        w_type = item['type']
        if len(w_type) > 13:
            w_type = w_type[:11] + ".."
        c.drawString(x_weave, to_rl_y(y), w_type)
        
        # Page Number
        c.setFont("Helvetica-Bold", 6.5)
        c.setFillColor(HexColor("#475569"))
        c.drawRightString(x_pg, to_rl_y(y), str(pg_num))
        c.restoreState()
        
    draw_line(c, 36.0, 805.89, PAGE_WIDTH - 36.0, 805.89, color="#DCD5C9", width=0.75)
    c.saveState()
    c.setFont("Helvetica", 8.0)
    c.setFillColor(HexColor("#94A3B8"))
    c.drawString(36.0, to_rl_y(818.0), "Confidential • Commercial Saree Catalogue")
    c.setFont("Helvetica-Bold", 8.0)
    c.setFillColor(HexColor("#1E293B"))
    c.drawRightString(PAGE_WIDTH - 36.0, to_rl_y(818.0), f"Page 2 of {total_pages}")
    c.restoreState()
    
    c.showPage()
    
    # ==========================================
    # 3. PRODUCT PAGES (NO SPEC TABLE, 6 IMAGES GRID)
    # ==========================================
    for page_idx, item in enumerate(product_pages):
        pg_num = 3 + page_idx
        
        # Top Header
        c.saveState()
        c.setFont("Helvetica-Bold", 8.0)
        c.setFillColor(HexColor("#666666"))
        c.drawString(36.0, to_rl_y(21.4), "AVF LUXURY COLLECTION")
        c.setFont("Helvetica-Bold", 8.0)
        c.setFillColor(HexColor("#666666"))
        c.drawRightString(PAGE_WIDTH - 36.0, to_rl_y(21.4), "PHOTOSHOOT 1 • CATALOG")
        c.restoreState()
        
        draw_line(c, 36.0, 31.0, PAGE_WIDTH - 36.0, 31.0, color="#DCD5C9", width=0.75)
        
        # Title Line
        c.saveState()
        c.setFont("Helvetica-Bold", 15.0)
        c.setFillColor(HexColor("#111111"))
        c.drawString(36.0, to_rl_y(50.0), f"#{item['id']:02d}  {item['name'].upper()}")
        
        c.setFont("Helvetica-Bold", 10.0)
        c.setFillColor(HexColor("#B85C38"))
        c.drawRightString(PAGE_WIDTH - 36.0, to_rl_y(50.0), f"SKU: {item['sku']}")
        c.restoreState()
        
        imgs = item["images"]
        num_imgs = len(imgs)
        
        # HERO IMAGE (Left Column): x1=36.0, x2=396.0, y1=88.0, y2=568.0 (width 360, height 480)
        if num_imgs > 0:
            draw_bento_full_cover(c, imgs[0], 36.0, 88.0, 396.0, 568.0, radius=4)
            
        # TOP-RIGHT IMAGE 1 (Replaces Spec Table!): x1=404.0, x2=558.0, y1=88.0, y2=323.0 (width 154, height 235)
        if num_imgs > 1:
            draw_bento_full_cover(c, imgs[1], 404.0, 88.0, 558.0, 323.0, radius=4)
            
        # TOP-RIGHT IMAGE 2: x1=404.0, x2=558.0, y1=333.0, y2=568.0 (width 154, height 235)
        if num_imgs > 2:
            draw_bento_full_cover(c, imgs[2], 404.0, 333.0, 558.0, 568.0, radius=4)

        # BOTTOM ROW IMAGE 1: x1=36.0, x2=198.0, y1=580.0, y2=796.0 (width 162, height 216)
        if num_imgs > 3:
            draw_bento_full_cover(c, imgs[3], 36.0, 580.0, 198.0, 796.0, radius=4)

        # BOTTOM ROW IMAGE 2: x1=216.0, x2=378.0, y1=580.0, y2=796.0 (width 162, height 216)
        if num_imgs > 4:
            draw_bento_full_cover(c, imgs[4], 216.0, 580.0, 378.0, 796.0, radius=4)

        # BOTTOM ROW IMAGE 3 (ADDED 1 MORE IMAGE!): x1=396.0, x2=558.0, y1=580.0, y2=796.0 (width 162, height 216)
        if num_imgs > 5:
            draw_bento_full_cover(c, imgs[5], 396.0, 580.0, 558.0, 796.0, radius=4)

        # Footer
        draw_line(c, 36.0, 805.89, PAGE_WIDTH - 36.0, 805.89, color="#DCD5C9", width=0.75)
        c.saveState()
        c.setFont("Helvetica", 8.0)
        c.setFillColor(HexColor("#666666"))
        c.drawString(36.0, to_rl_y(818.0), "Confidential • Commercial Saree Catalogue")
        c.setFont("Helvetica-Bold", 8.0)
        c.setFillColor(HexColor("#111111"))
        c.drawRightString(PAGE_WIDTH - 36.0, to_rl_y(818.0), f"Page {pg_num} of {total_pages}")
        c.restoreState()
        
        c.showPage()
        
    # ==========================================
    # 4. BACK COVER (THANK YOU PAGE)
    # ==========================================
    draw_rect(c, 0, 0, PAGE_WIDTH, PAGE_HEIGHT, fill_color="#0D1117")
    draw_rect(c, 24.0, 24.0, PAGE_WIDTH - 24.0, PAGE_HEIGHT - 24.0, stroke_color="#C5A059", stroke_width=1.2)
    draw_rect(c, 28.0, 28.0, PAGE_WIDTH - 28.0, PAGE_HEIGHT - 28.0, stroke_color="#C5A059", stroke_width=0.6)
    
    c.saveState()
    c.setFont("Helvetica-Bold", 22)
    c.setFillColor(HexColor("#FFFFFF"))
    c.drawCentredString(PAGE_WIDTH / 2, to_rl_y(320), "AVF LUXURY COLLECTION")
    
    c.setFont("Helvetica", 12)
    c.setFillColor(HexColor("#C5A059"))
    c.drawCentredString(PAGE_WIDTH / 2, to_rl_y(355), "THANK YOU FOR REVIEWING OUR COLLECTION")
    
    draw_line(c, 180, 385, PAGE_WIDTH - 180, 385, color="#C5A059", width=0.75)
    
    c.setFont("Helvetica", 9)
    c.setFillColor(HexColor("#94A3B8"))
    c.drawCentredString(PAGE_WIDTH / 2, to_rl_y(420), "For commercial inquiries, fabric customizations, or bulk orders:")
    
    c.setFont("Helvetica-Bold", 11)
    c.setFillColor(HexColor("#FFFFFF"))
    c.drawCentredString(PAGE_WIDTH / 2, to_rl_y(445), "AVF TEXTILE HOUSE")
    
    c.setFont("Helvetica", 9)
    c.setFillColor(HexColor("#94A3B8"))
    c.drawCentredString(PAGE_WIDTH / 2, to_rl_y(465), "High Fashion Saree & Fabric Design Studio")
    
    c.setFont("Helvetica", 8)
    c.setFillColor(HexColor("#64748B"))
    c.drawCentredString(PAGE_WIDTH / 2, to_rl_y(780), "© 2026 AVF Collection. All rights reserved.")
    c.restoreState()
    
    c.showPage()
    c.save()
    print(f"Successfully generated updated Lookbook 1 PDF at: {pdf_path}")

if __name__ == "__main__":
    generate_catalog()
