(() => {
  const brandIntro = document.querySelector('.brand-intro');
  if (brandIntro && document.documentElement.classList.contains('orvella-intro-active')) {
    const skipButton = brandIntro.querySelector('.brand-intro-skip');
    let introTimer;
    let closeTimer;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') finishIntro();
    };
    const finishIntro = () => {
      if (brandIntro.classList.contains('is-leaving')) return;
      window.clearTimeout(introTimer);
      document.removeEventListener('keydown', onKeyDown);
      brandIntro.classList.add('is-leaving');
      closeTimer = window.setTimeout(() => {
        document.documentElement.classList.remove('orvella-intro-active');
        brandIntro.remove();
      }, 750);
    };

    skipButton?.addEventListener('click', finishIntro);
    document.addEventListener('keydown', onKeyDown);
    skipButton?.focus({ preventScroll: true });
    introTimer = window.setTimeout(finishIntro, 4200);
    window.addEventListener('pagehide', () => {
      window.clearTimeout(introTimer);
      window.clearTimeout(closeTimer);
    }, { once: true });
  }

  const loader = document.createElement('div');
  loader.id = 'page-loader';
  loader.innerHTML = '<span class="loading-spinner" aria-label="Loading"></span>';
  document.body.appendChild(loader);
  document.querySelectorAll('form').forEach((form) => {
    form.addEventListener('submit', () => {
      form.setAttribute('aria-busy', 'true');
      const button = form.querySelector('button[type="submit"], button:not([type])');
      if (button && !button.disabled) {
        button.dataset.originalText = button.textContent;
      }
    });
  });
})();
