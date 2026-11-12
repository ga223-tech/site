/* Главная: слайдер, каталог из JS-массива, поиск, фильтры, избранное и окно деталей. */
(function () {
  'use strict';

  const PLANETS = window.OrbitaData.PLANETS;
  let activeCategory = 'Все';
  let searchTerm = '';
  let activePlanet = null;

  function announce(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('visible');
    window.clearTimeout(announce.timer);
    announce.timer = window.setTimeout(() => toast.classList.remove('visible'), 3400);
  }

  function renderCards() {
    const grid = document.getElementById('cardsGrid');
    if (!grid) return;
    const user = window.OrbitaAuth.getSession();
    const saved = user ? window.OrbitaAuth.getFavorites(user.id) : [];
    const visible = PLANETS.filter(planet => {
      const matchesCategory = activeCategory === 'Все' || planet.category === activeCategory;
      const text = `${planet.name} ${planet.description} ${planet.category}`.toLocaleLowerCase('ru');
      return matchesCategory && text.includes(searchTerm);
    });

    grid.innerHTML = visible.map((planet, index) => `
      <article class="planet-card" style="--planet-accent:${planet.accent};--order:${index}">
        <div class="planet-card__visual">
          <span class="planet-card__number">${String(PLANETS.indexOf(planet) + 1).padStart(2, '0')} / 08</span>
          <button class="favorite-toggle ${saved.includes(planet.id) ? 'is-saved' : ''}" type="button"
            data-favorite="${planet.id}" aria-label="${saved.includes(planet.id) ? 'Убрать из избранного' : 'Добавить в избранное'}: ${planet.name}"
            aria-pressed="${saved.includes(planet.id)}" title="${saved.includes(planet.id) ? 'Убрать из избранного' : 'В избранное'}">
            <span aria-hidden="true">${saved.includes(planet.id) ? '♥' : '♡'}</span>
          </button>
          <img class="planet-card__image" src="${planet.image}" alt="Иллюстрация планеты ${planet.name}" width="280" height="280" loading="lazy">
          <span class="planet-card__orbit" aria-hidden="true"></span>
        </div>
        <div class="planet-card__body">
          <span class="eyebrow muted">${planet.category}</span>
          <h3>${planet.name}</h3>
          <p>${planet.description}</p>
          <button class="planet-card__details" type="button" data-details="${planet.id}">
            Подробнее <span aria-hidden="true">↗</span>
          </button>
        </div>
      </article>
    `).join('');
    const empty = document.getElementById('catalogEmpty');
    if (empty) empty.hidden = visible.length !== 0;
    const count = document.getElementById('resultCount');
    if (count) count.textContent = `${visible.length} из ${PLANETS.length}`;
  }

  function showDetails(planetId) {
    const planet = PLANETS.find(item => item.id === planetId);
    const dialog = document.getElementById('planetDialog');
    if (!planet || !dialog) return;
    activePlanet = planetId;
    const image = document.getElementById('dialogImage');
    image.src = planet.image;
    image.alt = `Иллюстрация планеты ${planet.name}`;
    document.getElementById('dialogCategory').textContent = planet.category;
    document.getElementById('dialogTitle').textContent = planet.name;
    document.getElementById('dialogSubtitle').textContent = planet.subtitle;
    document.getElementById('dialogDescription').textContent = planet.detail;
    document.getElementById('dialogDistance').textContent = planet.distance;
    document.getElementById('dialogYear').textContent = planet.year;
    document.getElementById('dialogHighlight').textContent = planet.highlight;
    updateDialogFavorite();
    dialog.showModal();
  }

  function updateDialogFavorite() {
    if (!activePlanet) return;
    const user = window.OrbitaAuth.getSession();
    const saved = user && window.OrbitaAuth.getFavorites(user.id).includes(activePlanet);
    const button = document.getElementById('dialogFavorite');
    if (button) {
      button.textContent = saved ? '♥ В избранном' : '♡ В избранное';
      button.setAttribute('aria-pressed', String(Boolean(saved)));
    }
  }

  function saveFavorite(id) {
    const result = window.OrbitaAuth.toggleFavorite(id);
    if (!result.ok) {
      announce('Чтобы сохранить планету, сначала войдите или зарегистрируйтесь.');
      return;
    }
    renderCards();
    updateDialogFavorite();
    announce(result.saved ? 'Планета добавлена в избранное.' : 'Планета удалена из избранного.');
  }

  function initCatalog() {
    const grid = document.getElementById('cardsGrid');
    if (!grid) return;
    const search = document.getElementById('catalogSearch');
    const clear = document.getElementById('clearSearch');
    search.addEventListener('input', () => {
      searchTerm = search.value.trim().toLocaleLowerCase('ru');
      clear.hidden = !searchTerm;
      renderCards();
    });
    clear.addEventListener('click', () => {
      search.value = '';
      searchTerm = '';
      clear.hidden = true;
      search.focus();
      renderCards();
    });

    document.querySelectorAll('[data-category]').forEach(button => button.addEventListener('click', () => {
      activeCategory = button.dataset.category;
      document.querySelectorAll('[data-category]').forEach(tab => {
        const selected = tab === button;
        tab.classList.toggle('active', selected);
        tab.setAttribute('aria-pressed', String(selected));
      });
      renderCards();
    }));

    grid.addEventListener('click', event => {
      const favorite = event.target.closest('[data-favorite]');
      if (favorite) return saveFavorite(favorite.dataset.favorite);
      const details = event.target.closest('[data-details]');
      if (details) showDetails(details.dataset.details);
    });
    const dialog = document.getElementById('planetDialog');
    if (dialog) {
      dialog.addEventListener('click', event => {
        if (event.target === dialog) dialog.close();
      });
      document.getElementById('dialogFavorite').addEventListener('click', () => saveFavorite(activePlanet));
    }
    renderCards();
  }

  function initSlider() {
    const slider = document.getElementById('featureSlider');
    if (!slider) return;
    const slides = Array.from(slider.querySelectorAll('.slide'));
    const dots = Array.from(slider.querySelectorAll('[data-slide-dot]'));
    const previous = slider.querySelector('[data-prev]');
    const next = slider.querySelector('[data-next]');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let current = 0;
    let timer = null;

    function showSlide(index) {
      current = (index + slides.length) % slides.length;
      slides.forEach((slide, i) => {
        const active = i === current;
        slide.classList.toggle('active', active);
        slide.setAttribute('aria-hidden', String(!active));
      });
      dots.forEach((dot, i) => {
        const active = i === current;
        dot.classList.toggle('active', active);
        dot.setAttribute('aria-current', String(active));
        dot.setAttribute('aria-label', `Показать слайд ${i + 1} из ${slides.length}`);
      });
      const counter = document.getElementById('slideCurrent');
      if (counter) counter.textContent = String(current + 1).padStart(2, '0');
    }
    function stopAuto() {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
    }
    function startAuto() {
      stopAuto();
      if (!reducedMotion && !document.hidden) timer = window.setInterval(() => showSlide(current + 1), 5000);
    }
    function change(direction) {
      showSlide(current + direction);
      startAuto();
    }
    previous.addEventListener('click', () => change(-1));
    next.addEventListener('click', () => change(1));
    dots.forEach((dot, i) => dot.addEventListener('click', () => {
      showSlide(i);
      startAuto();
    }));
    slider.addEventListener('mouseenter', stopAuto);
    slider.addEventListener('mouseleave', startAuto);
    slider.addEventListener('focusin', stopAuto);
    slider.addEventListener('focusout', event => {
      if (!slider.contains(event.relatedTarget)) startAuto();
    });
    document.addEventListener('visibilitychange', () => document.hidden ? stopAuto() : startAuto());
    showSlide(0);
    startAuto();
  }

  document.addEventListener('DOMContentLoaded', () => {
    initSlider();
    initCatalog();
  });
})();
