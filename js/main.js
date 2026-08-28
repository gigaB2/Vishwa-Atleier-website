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
  initInquiryModal();
});

/* 1. Manufacturing Process Stepper */
function initProcessStepper() {
  const tabs = document.querySelectorAll('.stepper-tab');
  const panes = document.querySelectorAll('.process-pane');
  const processSection = document.getElementById('process');

  if (!tabs.length || !panes.length) return;

  let currentStep = 0;

  function goToStep(index) {
    if (index < 0 || index >= tabs.length) return;
    currentStep = index;

    // Update Tab active styling
    tabs.forEach((t, i) => {
      if (i === currentStep) {
        t.classList.add('active', 'border-primary', 'text-primary');
        t.classList.remove('text-secondary', 'border-transparent');
      } else {
        t.classList.remove('active', 'border-primary', 'text-primary');
        t.classList.add('text-secondary', 'border-transparent');
      }
    });

    // Scroll active tab into view in #stepper-nav-bar
    const activeTab = tabs[currentStep];
    if (activeTab && activeTab.scrollIntoView) {
      activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }

    // Update Pane active state
    panes.forEach(pane => {
      pane.classList.add('hidden');
      pane.classList.remove('active');
      
      // Pause any HTML5 videos inside hidden panes
      const video = pane.querySelector('video');
      if (video) video.pause();
    });

    const activePane = document.getElementById(`pane-${currentStep}`);
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
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => {
      goToStep(index);
    });
  });

  // Touch & Pointer Swipe Support for Mobile, Tablet, and Touch Screen Laptops
  if (processSection) {
    let startX = 0;
    let startY = 0;
    let isDragging = false;
    let lastSwipeTime = 0;

    // Touch events for Mobile/Tablet
    processSection.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length > 0) {
        isDragging = true;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
      }
    }, { passive: true });

    processSection.addEventListener('touchend', (e) => {
      if (!isDragging || !e.changedTouches || !e.changedTouches.length) return;
      isDragging = false;
      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      handleSwipe(startX, startY, endX, endY);
    }, { passive: true });

    // Pointer events for Touch-Screen Laptops & Pointer Devices
    processSection.addEventListener('pointerdown', (e) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
    }, { passive: true });

    processSection.addEventListener('pointerup', (e) => {
      if (!isDragging) return;
      isDragging = false;
      handleSwipe(startX, startY, e.clientX, e.clientY);
    }, { passive: true });

    // Mouse fallback for desktop / drag emulation
    processSection.addEventListener('mousedown', (e) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
    }, { passive: true });

    processSection.addEventListener('mouseup', (e) => {
      if (!isDragging) return;
      isDragging = false;
      handleSwipe(startX, startY, e.clientX, e.clientY);
    }, { passive: true });

    function handleSwipe(sX, sY, eX, eY) {
      const now = Date.now();
      if (now - lastSwipeTime < 300) return; // Guard against double execution

      const diffX = sX - eX;
      const diffY = sY - eY;

      // Ensure horizontal swipe is dominant and exceeds swipe threshold (30px)
      if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 30) {
        lastSwipeTime = now;
        if (diffX > 0 && currentStep < tabs.length - 1) {
          // Swipe Left -> Next Card
          goToStep(currentStep + 1);
        } else if (diffX < 0 && currentStep > 0) {
          // Swipe Right -> Previous Card
          goToStep(currentStep - 1);
        }
      }
    }
  }
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
        dot.setAttribute('aria-selected', 'true');
      } else {
        dot.classList.remove('opacity-100', 'bg-primary');
        dot.classList.add('opacity-40', 'bg-outline');
        dot.setAttribute('aria-selected', 'false');
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

  // Auto-Rolling Saree Images (Viewport Throttled for Performance)
  const rollingWraps = document.querySelectorAll('.rolling-wrap');
  if (rollingWraps.length) {
    if ('IntersectionObserver' in window) {
      const rollingObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          const wrap = entry.target;
          if (entry.isIntersecting) {
            if (!wrap._rollingTimer) {
              const images = wrap.querySelectorAll('.rolling-img');
              if (images.length <= 1) return;
              let imgIndex = 0;
              wrap._rollingTimer = setInterval(() => {
                images[imgIndex].classList.remove('active', 'opacity-100');
                images[imgIndex].classList.add('opacity-0');

                imgIndex = (imgIndex + 1) % images.length;

                images[imgIndex].classList.add('active', 'opacity-100');
                images[imgIndex].classList.remove('opacity-0');
              }, 3200);
            }
          } else {
            if (wrap._rollingTimer) {
              clearInterval(wrap._rollingTimer);
              wrap._rollingTimer = null;
            }
          }
        });
      }, { threshold: 0.1 });

      rollingWraps.forEach(wrap => rollingObserver.observe(wrap));
    } else {
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
  }
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
            link.classList.remove('text-secondary', 'text-primary/80');
          } else {
            link.classList.remove('text-primary', 'font-semibold');
            if (link.closest('#nav-menu')) {
              link.classList.add('text-secondary');
            } else {
              link.classList.add('text-primary/80');
            }
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

  function closeMenu() {
    navMenu.classList.add('hidden');
    toggleBtn.setAttribute('aria-expanded', 'false');
  }

  function openMenu() {
    navMenu.classList.remove('hidden');
    toggleBtn.setAttribute('aria-expanded', 'true');
  }

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = navMenu.classList.contains('hidden');
    if (isHidden) {
      openMenu();
    } else {
      closeMenu();
    }
  });

  navMenu.querySelectorAll('a, button').forEach(link => {
    link.addEventListener('click', () => {
      closeMenu();
    });
  });

  document.addEventListener('click', (e) => {
    if (!navMenu.contains(e.target) && !toggleBtn.contains(e.target)) {
      closeMenu();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !navMenu.classList.contains('hidden')) {
      closeMenu();
      toggleBtn.focus();
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
      dotsContainer.setAttribute('role', 'tablist');
      dotsContainer.setAttribute('aria-label', 'Group entities navigation');
      for (let i = 0; i <= maxIndex; i++) {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.setAttribute('role', 'tab');
        dot.setAttribute('aria-label', `Go to Group Entities Slide ${i + 1}`);
        dot.setAttribute('aria-selected', i === currentIndex ? 'true' : 'false');
        dot.className = `w-2.5 h-2.5 rounded-full cursor-pointer transition-all duration-300 p-0 border-0 ${i === currentIndex ? 'bg-primary scale-110' : 'bg-outline/40 hover:bg-outline'}`;
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
        // Autoplay policy or Low Power Mode restricted playback; will retry on gesture unlock
      });
    }
  }

  // Efficient IntersectionObserver with threshold 0.15 for auto-play / auto-pause
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const video = entry.target;
        const pane = video.closest('.process-pane');
        const isPaneHidden = pane && pane.classList.contains('hidden');

        if (entry.isIntersecting && !isPaneHidden) {
          prepareAndPlay(video);
        } else {
          video.pause();
        }
      });
    }, { threshold: 0.15 });

    videos.forEach(v => observer.observe(v));
  } else {
    // Fallback for environments without IntersectionObserver
    videos.forEach(video => {
      const pane = video.closest('.process-pane');
      if (!pane || !pane.classList.contains('hidden')) {
        prepareAndPlay(video);
      }
    });
  }

  // Single one-time gesture unlock for browsers/devices requiring interaction
  const unlockEvents = ['touchstart', 'pointerdown', 'click'];
  const unlockAutoplay = () => {
    unlockEvents.forEach(evt => window.removeEventListener(evt, unlockAutoplay));
    videos.forEach(video => {
      const pane = video.closest('.process-pane');
      if (!pane || !pane.classList.contains('hidden')) {
        prepareAndPlay(video);
      }
    });
  };

  unlockEvents.forEach(evt => {
    window.addEventListener(evt, unlockAutoplay, { passive: true, once: true });
  });

  // Re-attempt playback when returning to document focus
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      videos.forEach(video => {
        const pane = video.closest('.process-pane');
        if (!pane || !pane.classList.contains('hidden')) {
          prepareAndPlay(video);
        }
      });
    } else {
      videos.forEach(video => video.pause());
    }
  });
}

/* 7. Luxury B2B Inquiry & Sample Request Modal Controller */
function initInquiryModal() {
  const modal = document.getElementById('inquiry-modal');
  const closeBtn = document.getElementById('modal-close-btn');
  const form = document.getElementById('inquiry-form');
  const waBtn = document.getElementById('modal-wa-btn');
  const triggers = document.querySelectorAll('[data-open-modal="inquiry"]');

  if (!modal) return;

  let lastActiveTrigger = null;

  function openModal(presetInterest = '', triggerEl = null) {
    lastActiveTrigger = triggerEl;
    if (presetInterest) {
      const select = document.getElementById('lead-interest');
      if (select) {
        let matched = false;
        for (let i = 0; i < select.options.length; i++) {
          if (select.options[i].value.toLowerCase().includes(presetInterest.toLowerCase()) ||
              presetInterest.toLowerCase().includes(select.options[i].value.toLowerCase())) {
            select.selectedIndex = i;
            matched = true;
            break;
          }
        }
        if (!matched) select.value = presetInterest;
      }
    }
    modal.classList.remove('opacity-0', 'pointer-events-none');
    modal.classList.add('opacity-100', 'pointer-events-auto');
    const inner = modal.querySelector('div');
    if (inner) {
      inner.classList.remove('scale-95');
      inner.classList.add('scale-100');
    }
    document.body.classList.add('overflow-hidden');

    // Autofocus first input after modal transition
    setTimeout(() => {
      const firstInput = document.getElementById('lead-name');
      if (firstInput) firstInput.focus();
    }, 100);
  }

  function closeModal() {
    modal.classList.add('opacity-0', 'pointer-events-none');
    modal.classList.remove('opacity-100', 'pointer-events-auto');
    const inner = modal.querySelector('div');
    if (inner) {
      inner.classList.remove('scale-100');
      inner.classList.add('scale-95');
    }
    document.body.classList.remove('overflow-hidden');

    if (lastActiveTrigger && typeof lastActiveTrigger.focus === 'function') {
      lastActiveTrigger.focus();
    }
  }

  triggers.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const interest = btn.getAttribute('data-interest') || '';
      openModal(interest, btn);
    });
  });

  if (closeBtn) closeBtn.addEventListener('click', closeModal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('pointer-events-none')) {
      closeModal();
    }
  });

  function getFormData() {
    return {
      name: document.getElementById('lead-name')?.value?.trim() || '',
      phone: document.getElementById('lead-phone')?.value?.trim() || '',
      email: document.getElementById('lead-email')?.value?.trim() || '',
      interest: document.getElementById('lead-interest')?.value || '',
      moq: document.getElementById('lead-moq')?.value || '',
      message: document.getElementById('lead-message')?.value?.trim() || ''
    };
  }

  if (waBtn) {
    waBtn.addEventListener('click', () => {
      const data = getFormData();
      if (!data.name || !data.phone) {
        const nameInput = document.getElementById('lead-name');
        if (!data.name && nameInput) {
          nameInput.focus();
          return;
        }
        const phoneInput = document.getElementById('lead-phone');
        if (!data.phone && phoneInput) {
          phoneInput.focus();
          return;
        }
      }
      const text = `Hello Vishwa Atelier,%0A%0A*New B2B Inquiry:*%0A• *Name / Entity:* ${encodeURIComponent(data.name || 'Trade Buyer')}%0A• *Contact:* ${encodeURIComponent(data.phone)}%0A• *Email:* ${encodeURIComponent(data.email || 'N/A')}%0A• *Requirement:* ${encodeURIComponent(data.interest)}%0A• *Volume / MOQ:* ${encodeURIComponent(data.moq)}%0A• *Notes:* ${encodeURIComponent(data.message || 'N/A')}`;
      window.open(`https://wa.me/919313772824?text=${text}`, '_blank');
      closeModal();
    });
  }

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = getFormData();
      const subject = encodeURIComponent(`B2B Inquiry: ${data.interest} - ${data.name}`);
      const body = encodeURIComponent(`Name / Company: ${data.name}\nWhatsApp / Phone: ${data.phone}\nCorporate Email: ${data.email || 'N/A'}\nProduct Requirement: ${data.interest}\nEstimated Volume / MOQ: ${data.moq}\n\nSpecifications / Notes:\n${data.message || 'N/A'}`);
      window.location.href = `mailto:vishwa@vishwafashions.com,rajiv@vishwafashions.com?subject=${subject}&body=${body}`;
      closeModal();
    });
  }
}


