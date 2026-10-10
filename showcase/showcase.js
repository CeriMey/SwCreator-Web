(() => {
  'use strict';
  // Preserve existing bridge links and the previous direct-launch bookmark.
  const current = new URL(location.href);
  if (current.hash === '#atelier' || current.hash.includes('=') || ['bridge', 'claudeRelay'].some(key => current.searchParams.has(key))) {
    const app = new URL('SwCreatorWeb.html', current);
    app.search = current.search;
    app.hash = current.hash === '#atelier' ? '' : current.hash;
    location.replace(app.href);
    return;
  }
  const views = {
    designer: {
      fr: ['01 — DESIGNER', 'Dessinez votre interface.', 'Placez vos widgets, ajustez leurs propriétés et retrouvez le formulaire dans votre projet C++.', 'Le Designer visuel de Softi avec un formulaire de démonstration.'],
      en: ['01 — DESIGNER', 'Design your interface.', 'Place your widgets, adjust their properties and find the form in your C++ project.', 'The Softi visual designer with a demonstration form.']
    },
    code: {
      fr: ['02 — C++', 'Écrivez ce qui la rend unique.', 'Retrouvez les sources, les classes de vos formulaires et la logique de votre application dans l’éditeur C++.', 'L’éditeur C++ de Softi et les fichiers du projet MonApplication.'],
      en: ['02 — C++', 'Write what makes it yours.', 'Work with your sources, form classes and application logic in the C++ editor.', 'The Softi C++ editor and the MonApplication project files.']
    },
    installer: {
      fr: ['03 — INSTALLATION', 'Préparez sa prochaine étape.', 'Configurez le produit et les fichiers à distribuer, puis générez un installeur Windows ou Linux.', 'La page Installeur de Softi et la configuration du produit.'],
      en: ['03 — INSTALLATION', 'Prepare its next step.', 'Configure your product and its files, then build a Windows or Linux installer.', 'The Softi installer page with product configuration.']
    },
    documentation: {
      fr: ['04 — DOCUMENTATION', 'Gardez les réponses à portée de main.', 'Explorez les classes, les méthodes et les modules SwStack depuis la documentation intégrée.', 'La documentation SwStack intégrée à Softi.'],
      en: ['04 — DOCUMENTATION', 'Keep the answers close.', 'Explore SwStack classes, methods and modules in the integrated documentation.', 'The SwStack documentation integrated into Softi.']
    }
  };
  let language = 'fr';
  let selectedView = 'designer';
  const title = document.title;
  const targets = [...document.querySelectorAll('[data-en]')].map(element => ({element, fr: [...element.childNodes].map(node => node.cloneNode(true)), en: element.dataset.en}));
  const imageTargets = [...document.querySelectorAll('[data-en-alt]')].map(element => ({element, fr: element.alt, en: element.dataset.enAlt}));
  const descriptions = {
    fr: document.querySelector('meta[name="description"]').content,
    en: 'Create a C++ application with Softi: a code editor, visual designer and Windows and Linux installers, right in your browser.'
  };

  function updateGallery(view, focus = false) {
    selectedView = view;
    const text = views[view][language];
    document.querySelectorAll('[data-view]').forEach(tab => {
      const active = tab.dataset.view === view;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus();
    });
    document.getElementById('gallery-panel').setAttribute('aria-labelledby', 'tab-' + view);
    const img = document.getElementById('gallery-image');
    img.src = 'showcase/assets/captures/' + view + '.png';
    img.alt = text[3];
    img.closest('button').dataset.image = img.getAttribute('src');
    document.getElementById('gallery-number').textContent = text[0];
    document.getElementById('gallery-title').textContent = text[1];
    document.getElementById('gallery-description').textContent = text[2];
  }

  function applyLanguage(value, remember = false) {
    language = value === 'en' ? 'en' : 'fr';
    document.documentElement.lang = language;
    targets.forEach(target => {
      if (language === 'en') target.element.textContent = target.en;
      else target.element.replaceChildren(...target.fr.map(node => node.cloneNode(true)));
    });
    imageTargets.forEach(target => { target.element.alt = target[language]; });
    document.querySelectorAll('[data-language]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.language === language)));
    document.title = language === 'en' ? 'Softi — Your ideas become applications' : title;
    document.querySelector('meta[name="description"]').content = descriptions[language];
    document.querySelector('meta[property="og:title"]').content = document.title;
    document.querySelector('meta[property="og:description"]').content = descriptions[language];
    document.querySelector('meta[property="og:locale"]').content = language === 'en' ? 'en_US' : 'fr_FR';
    const labels = language === 'en'
      ? ['Main navigation', 'Enlarge the Softi designer screenshot', 'Software screenshots', 'Enlarge the screenshot', 'Softi screenshot', 'Enlarged Softi screenshot']
      : ['Navigation principale', 'Agrandir la capture du Designer Softi', 'Captures du logiciel', 'Agrandir la capture', 'Capture de Softi', 'Capture agrandie de Softi'];
    document.getElementById('navigation').setAttribute('aria-label', labels[0]);
    document.querySelector('.hero-media .zoom-image').setAttribute('aria-label', labels[1]);
    document.querySelector('[role="tablist"]').setAttribute('aria-label', labels[2]);
    document.querySelector('.gallery-image').setAttribute('aria-label', labels[3]);
    document.getElementById('image-viewer').setAttribute('aria-label', labels[4]);
    document.querySelector('#image-viewer img').alt = labels[5];
    updateGallery(selectedView);
    if (remember) {
      try { localStorage.setItem('softi-showcase-language', language); } catch {}
      const url = new URL(location.href);
      url.searchParams.set('lang', language);
      history.replaceState(null, '', url);
    }
  }
  document.querySelectorAll('[data-language]').forEach(button => button.addEventListener('click', () => applyLanguage(button.dataset.language, true)));
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => updateGallery(button.dataset.view)));
  const tabs = [...document.querySelectorAll('[data-view]')];
  document.querySelector('[role="tablist"]').addEventListener('keydown', event => {
    const index = tabs.indexOf(document.activeElement);
    if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    updateGallery(tabs[next].dataset.view, true);
  });
  const toggle = document.querySelector('.menu-toggle');
  const navigation = document.getElementById('navigation');
  function closeMenu() { toggle.setAttribute('aria-expanded', 'false'); navigation.classList.remove('is-open'); }
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    navigation.classList.toggle('is-open', open);
  });
  navigation.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') { closeMenu(); toggle.focus(); } });
  const viewer = document.getElementById('image-viewer');
  document.querySelectorAll('.zoom-image').forEach(button => button.addEventListener('click', () => {
    viewer.querySelector('img').src = button.dataset.image;
    viewer.showModal();
  }));
  viewer.querySelector('button').addEventListener('click', () => viewer.close());
  viewer.addEventListener('click', event => {
    if (event.target !== viewer) return;
    const bounds = viewer.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) viewer.close();
  });
  document.querySelectorAll('[data-report]').forEach(link => link.addEventListener('click', () => {
    const url = new URL('https://github.com/CeriMey/SwCreator-Web/issues/new');
    url.searchParams.set('title', '[Softi] ');
    url.searchParams.set('body', language === 'en'
      ? '## My goal\n\n## Steps to reproduce\n1. \n2. \n\n## Expected result\n\n## Actual result\n\n## Screenshot\n\n## Environment\nBrowser: ' + navigator.userAgent
      : '## Mon objectif\n\n## Étapes pour reproduire\n1. \n2. \n\n## Résultat attendu\n\n## Résultat constaté\n\n## Capture d’écran\n\n## Environnement\nNavigateur : ' + navigator.userAgent);
    link.href = url.href;
  }));
  let initial = current.searchParams.get('lang');
  if (!initial) { try { initial = localStorage.getItem('softi-showcase-language'); } catch {} }
  applyLanguage(initial);
})();
