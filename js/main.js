/**
 * Vishwa Atelier — Luxury Master Textile Controller
 */

document.addEventListener('DOMContentLoaded', () => {
  initProcessStepper();
  initLookbookSlider();
  initNavbarScrollspy();
  initMobileMenu();
});

/* 1. Manufacturing Process Stepper */
function initProcessStepper() {
  const tabs = document.querySelectorAll('.stepper-tab');
  const panes = document.querySelectorAll('.process-pane');

  if (!tabs.length || !panes.length) return;

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => {
      // Update Tab active styling
      tabs.forEach(t => {
        t.classList.remove('active', 'border-primary', 'text-primary');
        t.classList.add('text-secondary', 'border-transparent');
      });
      tab.classList.add('active', 'border-primary', 'text-primary');
      tab.classList.remove('text-secondary', 'border-transparent');

      // Update Pane active state
      panes.forEach(pane => {
        pane.classList.add('hidden');
        pane.classList.remove('active');
        
        // Pause any HTML5 videos inside hidden panes
        const video = pane.querySelector('video');
        if (video) video.pause();
      });

      const activePane = document.getElementById(`pane-${index}`);
      if (activePane) {
        activePane.classList.remove('hidden');
        activePane.classList.add('active');
        
        // Play active video if available
        const activeVideo = activePane.querySelector('video');
        if (activeVideo) {
          activeVideo.play().catch(() => {});
        }
      }
    });
  });
}

/* 2. Interactive Lookbook Slider & Auto-Rolling Saree Showcase */
function initLookbookSlider() {
  const track = document.getElementById('lb-track');
  const slides = document.querySelectorAll('.lb-slide');
  const prevBtn = document.getElementById('lb-prev-btn');
  const nextBtn = document.getElementById('lb-next-btn');
  const tabBtns = document.querySelectorAll('.lb-tab-btn');
  const dotBtns = document.querySelectorAll('.lb-dot');
  
  if (!track || slides.length === 0) return;

  let currentIndex = 0;
  const totalSlides = slides.length;

  function updateSlider(index) {
    currentIndex = (index + totalSlides) % totalSlides;
    track.style.transform = `translateX(-${currentIndex * 100}%)`;

    // Update active tab buttons
    tabBtns.forEach((btn, i) => {
      if (i === currentIndex) {
        btn.classList.add('active', 'bg-primary', 'text-white', 'border-primary');
        btn.classList.remove('bg-white', 'text-primary', 'border-outline-variant');
      } else {
        btn.classList.remove('active', 'bg-primary', 'text-white', 'border-primary');
        btn.classList.add('bg-white', 'text-primary', 'border-outline-variant');
      }
    });

    // Update active dots
    dotBtns.forEach((dot, i) => {
      if (i === currentIndex) {
        dot.classList.add('opacity-100', 'bg-primary');
        dot.classList.remove('opacity-40', 'bg-outline');
      } else {
        dot.classList.remove('opacity-100', 'bg-primary');
        dot.classList.add('opacity-40', 'bg-outline');
      }
    });
  }

  // Nav Button Events
  if (prevBtn) prevBtn.addEventListener('click', () => updateSlider(currentIndex - 1));
  if (nextBtn) nextBtn.addEventListener('click', () => updateSlider(currentIndex + 1));

  // Tab & Dot Events
  tabBtns.forEach((btn, index) => {
    btn.addEventListener('click', () => updateSlider(index));
  });
  dotBtns.forEach((dot, index) => {
    dot.addEventListener('click', () => updateSlider(index));
  });

  // Touch & Drag Swipe Support
  let startX = 0;
  let isDragging = false;
  const trackContainer = document.getElementById('lb-track-container');

  if (trackContainer) {
    trackContainer.addEventListener('touchstart', (e) => {
      isDragging = true;
      startX = e.touches[0].clientX;
    }, { passive: true });

    trackContainer.addEventListener('touchend', (e) => {
      if (!isDragging) return;
      isDragging = false;
      const endX = e.changedTouches[0].clientX;
      const diffX = startX - endX;
      if (Math.abs(diffX) > 40) {
        if (diffX > 0) updateSlider(currentIndex + 1);
        else updateSlider(currentIndex - 1);
      }
    });
  }

  // Auto-Rolling Saree Images Inside Each Lookbook Card
  const rollingWraps = document.querySelectorAll('.rolling-wrap');
  rollingWraps.forEach(wrap => {
    const images = wrap.querySelectorAll('.rolling-img');
    if (images.length <= 1) return;

    let imgIndex = 0;
    setInterval(() => {
      images[imgIndex].classList.remove('active', 'opacity-100');
      images[imgIndex].classList.add('opacity-0');

      imgIndex = (imgIndex + 1) % images.length;

      images[imgIndex].classList.add('active', 'opacity-100');
      images[imgIndex].classList.remove('opacity-0');
    }, 3200);
  });
}

/* 3. Navbar Scrollspy & Dynamic Header Backdrop */
function initNavbarScrollspy() {
  const header = document.getElementById('site-header');
  const navLinks = document.querySelectorAll('.nav-link');
  const sections = document.querySelectorAll('section, footer');

  if (!header) return;

  window.addEventListener('scroll', () => {
    if (window.scrollY > 40) {
      header.classList.add('shadow-sm', 'bg-surface/95');
    } else {
      header.classList.remove('shadow-sm', 'bg-surface/95');
    }
  });

  // Scrollspy active link detection
  const observerOptions = {
    root: null,
    rootMargin: '-30% 0px -60% 0px',
    threshold: 0
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.getAttribute('id');
        navLinks.forEach(link => {
          if (link.getAttribute('href') === `#${id}`) {
            link.classList.add('text-primary', 'font-semibold');
            link.classList.remove('text-secondary');
          } else {
            link.classList.remove('text-primary', 'font-semibold');
            link.classList.add('text-secondary');
          }
        });
      }
    });
  }, observerOptions);

  sections.forEach(section => {
    if (section.getAttribute('id')) observer.observe(section);
  });
}

/* 4. Mobile Navigation Toggle */
function initMobileMenu() {
  const toggleBtn = document.getElementById('mobile-toggle-btn');
  const navMenu = document.getElementById('nav-menu');

  if (!toggleBtn || !navMenu) return;

  toggleBtn.addEventListener('click', () => {
    navMenu.classList.toggle('hidden');
    navMenu.classList.toggle('flex');
    navMenu.classList.toggle('flex-col');
    navMenu.classList.toggle('absolute');
    navMenu.classList.toggle('top-full');
    navMenu.classList.toggle('left-0');
    navMenu.classList.toggle('w-full');
    navMenu.classList.toggle('bg-white');
    navMenu.classList.toggle('p-6');
    navMenu.classList.toggle('shadow-lg');
    navMenu.classList.toggle('border-b');
    navMenu.classList.toggle('border-outline-variant');
  });
}
