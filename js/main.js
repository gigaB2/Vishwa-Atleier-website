/**
 * Vishwa Atelier — Luxury Master Textile Controller
 */

document.addEventListener('DOMContentLoaded', () => {
  initProcessStepper();
  initLookbookSlider();
  initNavbarScrollspy();
  initMobileMenu();
  initGroupCompaniesSlider();
  initAutoplayVideos();
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
          activeVideo.muted = true;
          activeVideo.defaultMuted = true;
          activeVideo.playsInline = true;
          activeVideo.setAttribute('playsinline', '');
          activeVideo.setAttribute('webkit-playsinline', '');
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

/* 4. Dropdown Navigation Controller */
function initMobileMenu() {
  const toggleBtn = document.getElementById('mobile-toggle-btn');
  const navMenu = document.getElementById('nav-menu');

  if (!toggleBtn || !navMenu) return;

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    navMenu.classList.toggle('hidden');
  });

  navMenu.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      navMenu.classList.add('hidden');
    });
  });

  document.addEventListener('click', (e) => {
    if (!navMenu.contains(e.target) && !toggleBtn.contains(e.target)) {
      navMenu.classList.add('hidden');
    }
  });
}

/* 5. Group Companies 3-Card Row Slider */
function initGroupCompaniesSlider() {
  const track = document.getElementById('gc-track');
  const trackContainer = document.getElementById('gc-track-container');
  const cards = document.querySelectorAll('.gc-card');
  const prevBtn = document.getElementById('gc-prev-btn');
  const nextBtn = document.getElementById('gc-next-btn');
  const dotsContainer = document.getElementById('gc-dots');
  
  if (!track || !cards.length) return;

  let currentIndex = 0;

  function getVisibleCount() {
    if (window.innerWidth >= 1024) return 3;
    return 1;
  }

  function getMaxIndex() {
    return Math.max(0, cards.length - getVisibleCount());
  }

  function updateSlider() {
    const visibleCount = getVisibleCount();
    const maxIndex = getMaxIndex();
    
    if (currentIndex > maxIndex) currentIndex = maxIndex;
    if (currentIndex < 0) currentIndex = 0;

    const gap = 24; // 24px gap (gap-6)
    const cardWidth = cards[0].offsetWidth || (trackContainer ? trackContainer.clientWidth : 300);
    const shiftAmount = currentIndex * (cardWidth + gap);
    
    track.style.transform = `translateX(-${shiftAmount}px)`;

    if (prevBtn) {
      prevBtn.disabled = currentIndex === 0;
      prevBtn.style.opacity = currentIndex === 0 ? '0.3' : '1';
      prevBtn.style.cursor = currentIndex === 0 ? 'not-allowed' : 'pointer';
    }
    if (nextBtn) {
      nextBtn.disabled = currentIndex >= maxIndex;
      nextBtn.style.opacity = currentIndex >= maxIndex ? '0.3' : '1';
      nextBtn.style.cursor = currentIndex >= maxIndex ? 'not-allowed' : 'pointer';
    }

    if (dotsContainer) {
      dotsContainer.innerHTML = '';
      for (let i = 0; i <= maxIndex; i++) {
        const dot = document.createElement('span');
        dot.className = `w-2.5 h-2.5 rounded-full cursor-pointer transition-all duration-300 ${i === currentIndex ? 'bg-primary scale-110' : 'bg-outline/40 hover:bg-outline'}`;
        dot.addEventListener('click', () => {
          currentIndex = i;
          updateSlider();
        });
        dotsContainer.appendChild(dot);
      }
    }
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (currentIndex > 0) {
        currentIndex--;
        updateSlider();
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (currentIndex < getMaxIndex()) {
        currentIndex++;
        updateSlider();
      }
    });
  }

  // Touch / Swipe support
  let startX = 0;
  let isDragging = false;

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
        if (diffX > 0 && currentIndex < getMaxIndex()) {
          currentIndex++;
        } else if (diffX < 0 && currentIndex > 0) {
          currentIndex--;
        }
        updateSlider();
      }
    });
  }

  window.addEventListener('resize', updateSlider);
  setTimeout(updateSlider, 100);
  updateSlider();
}

/* 6. Cross-Platform Mobile Video Autoplay Engine (iOS & Android) */
function initAutoplayVideos() {
  const videos = document.querySelectorAll('video');
  if (!videos.length) return;

  function prepareAndPlay(video) {
    if (!video) return;
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('x5-playsinline', 'true');

    const promise = video.play();
    if (promise !== undefined) {
      promise.catch(() => {
        // Autoplay policy or Low Power Mode restricted playback; will retry on interaction
      });
    }
  }

  function playVisibleVideos() {
    videos.forEach(video => {
      const pane = video.closest('.process-pane');
      if (!pane || !pane.classList.contains('hidden')) {
        prepareAndPlay(video);
      }
    });
  }

  // Attempt initial playback immediately and on window load
  playVisibleVideos();
  window.addEventListener('load', playVisibleVideos);

  // Re-trigger playback on user gestures (touch, tap, scroll) for iOS/Android Low Power Mode
  const interactionEvents = ['touchstart', 'touchend', 'pointerdown', 'click', 'scroll'];
  const handleUserGesture = () => {
    playVisibleVideos();
  };

  interactionEvents.forEach(evt => {
    window.addEventListener(evt, handleUserGesture, { passive: true });
  });

  // Re-attempt playback when returning to document focus
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      playVisibleVideos();
    }
  });

  // IntersectionObserver to auto-start video when scrolling into viewport on mobile
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const video = entry.target;
        const pane = video.closest('.process-pane');
        const isPaneHidden = pane && pane.classList.contains('hidden');

        if (entry.isIntersecting && !isPaneHidden) {
          prepareAndPlay(video);
        }
      });
    }, { threshold: 0.1 });

    videos.forEach(v => observer.observe(v));
  }
}

