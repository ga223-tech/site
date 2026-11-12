/* Учебная авторизация без сервера: пользователи и сеанс в localStorage.
   Пароли не записываются в открытом виде, но браузерное хранилище НЕ заменяет backend. */
(function () {
  'use strict';

  const USERS_KEY = 'orbita:users:v1';
  const SESSION_KEY = 'orbita:session:v1';
  const ITERATIONS = 120000;

  const readJSON = (key, fallback) => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  };

  const writeJSON = (key, value) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  };

  function getUsers() {
    const users = readJSON(USERS_KEY, []);
    return Array.isArray(users) ? users : [];
  }

  function getSession() {
    const session = readJSON(SESSION_KEY, null);
    if (!session || typeof session.id !== 'string') return null;
    const user = getUsers().find(item => item.id === session.id);
    if (!user) return null;
    return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt };
  }

  function bytesToHex(bytes) {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function hexToBytes(hex) {
    return new Uint8Array(hex.match(/.{2}/g).map(part => Number.parseInt(part, 16)));
  }

  async function hashPassword(password, salt) {
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error('Для регистрации откройте сайт через localhost или HTTPS: требуется Web Crypto API.');
    }
    const passwordKey = await window.crypto.subtle.importKey(
      'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
    );
    const bits = await window.crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: hexToBytes(salt), iterations: ITERATIONS, hash: 'SHA-256' },
      passwordKey,
      256
    );
    return bytesToHex(new Uint8Array(bits));
  }

  function normalizeEmail(email) {
    return email.trim().toLowerCase();
  }

  async function registerUser(name, email, password) {
    const users = getUsers();
    email = normalizeEmail(email);
    name = name.trim();
    if (users.some(user => user.email === email)) {
      return { ok: false, error: 'Аккаунт с таким email уже существует.' };
    }
    const salt = bytesToHex(window.crypto.getRandomValues(new Uint8Array(16)));
    const passwordHash = await hashPassword(password, salt);
    const user = {
      id: window.crypto.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${salt}`,
      name,
      email,
      salt,
      passwordHash,
      createdAt: new Date().toISOString()
    };
    users.push(user);
    writeJSON(USERS_KEY, users);
    writeJSON(SESSION_KEY, { id: user.id });
    return { ok: true, user: getSession() };
  }

  async function loginUser(email, password) {
    const user = getUsers().find(item => item.email === normalizeEmail(email));
    if (!user) return { ok: false, error: 'Неверный email или пароль.' };
    const hash = await hashPassword(password, user.salt);
    if (hash !== user.passwordHash) return { ok: false, error: 'Неверный email или пароль.' };
    writeJSON(SESSION_KEY, { id: user.id });
    return { ok: true, user: getSession() };
  }

  function logout() {
    window.localStorage.removeItem(SESSION_KEY);
    window.location.href = 'index.html';
  }

  function getFavorites(userId) {
    const favorites = readJSON(`orbita:favorites:${userId}`, []);
    return Array.isArray(favorites) ? favorites : [];
  }

  function toggleFavorite(planetId) {
    const user = getSession();
    if (!user) return { ok: false, error: 'Войдите в аккаунт, чтобы сохранять планеты.' };
    const ids = getFavorites(user.id);
    const updated = ids.includes(planetId) ? ids.filter(id => id !== planetId) : [...ids, planetId];
    writeJSON(`orbita:favorites:${user.id}`, updated);
    return { ok: true, saved: updated.includes(planetId) };
  }

  function updateHeader() {
    const user = getSession();
    document.body.classList.toggle('logged-in', Boolean(user));
    document.querySelectorAll('[data-user-name]').forEach(node => {
      node.textContent = user ? user.name.split(/\s+/)[0] : '';
    });
  }

  function initMenu() {
    const menuButton = document.getElementById('menuBtn');
    const nav = document.getElementById('mainNav');
    if (!menuButton || !nav) return;

    function closeMenu() {
      nav.classList.remove('open');
      menuButton.setAttribute('aria-expanded', 'false');
      menuButton.setAttribute('aria-label', 'Открыть меню');
    }
    menuButton.addEventListener('click', () => {
      const isOpen = nav.classList.toggle('open');
      menuButton.setAttribute('aria-expanded', String(isOpen));
      menuButton.setAttribute('aria-label', isOpen ? 'Закрыть меню' : 'Открыть меню');
    });
    nav.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeMenu();
    });
    document.addEventListener('click', event => {
      if (!nav.contains(event.target) && !menuButton.contains(event.target)) closeMenu();
    });
  }

  function setFieldError(id, error) {
    const field = document.getElementById(id);
    const message = document.getElementById(`${id}Error`);
    if (field) field.setAttribute('aria-invalid', error ? 'true' : 'false');
    if (message) message.textContent = error || '';
  }

  function setFormMessage(formId, message, type = 'error') {
    const node = document.querySelector(`#${formId} [data-form-message]`);
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('form-message--success', type === 'success');
    node.hidden = !message;
  }

  function initAuthPage() {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    if (!loginForm || !registerForm) return;
    const tabs = Array.from(document.querySelectorAll('[data-auth-tab]'));

    function switchTab(tab) {
      const isRegister = tab === 'register';
      loginForm.hidden = isRegister;
      registerForm.hidden = !isRegister;
      tabs.forEach(button => {
        const selected = button.dataset.authTab === tab;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
      });
      document.getElementById('authTitle').textContent = isRegister ? 'Создать аккаунт' : 'С возвращением!';
      document.getElementById('authIntro').textContent = isRegister
        ? 'Присоединяйтесь к исследователям и сохраняйте любимые планеты.'
        : 'Войдите, чтобы продолжить исследование и открыть избранное.';
      setFormMessage('loginForm', '');
      setFormMessage('registerForm', '');
    }
    tabs.forEach(button => button.addEventListener('click', () => {
      switchTab(button.dataset.authTab);
      window.history.replaceState(null, '', button.dataset.authTab === 'register' ? '#register' : '#login');
    }));
    switchTab(window.location.hash === '#register' ? 'register' : 'login');

    function destination() {
      // Только внутренние страницы проекта, чтобы ссылка next не стала открытым редиректом.
      const next = new URLSearchParams(window.location.search).get('next');
      if (next && /^(index|cabinet)\.html(#[a-z0-9-]+)?$/i.test(next)) return next;
      return 'cabinet.html';
    }

    loginForm.addEventListener('submit', async event => {
      event.preventDefault();
      ['loginEmail', 'loginPassword'].forEach(id => setFieldError(id, ''));
      setFormMessage('loginForm', '');
      const email = document.getElementById('loginEmail').value.trim();
      const password = document.getElementById('loginPassword').value;
      let valid = true;
      if (!/^\S+@\S+\.\S+$/.test(email)) {
        setFieldError('loginEmail', 'Введите корректный email.');
        valid = false;
      }
      if (!password) {
        setFieldError('loginPassword', 'Введите пароль.');
        valid = false;
      }
      if (!valid) return;
      const submit = loginForm.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        const result = await loginUser(email, password);
        if (!result.ok) return setFormMessage('loginForm', result.error);
        window.location.href = destination();
      } catch (error) {
        setFormMessage('loginForm', error.message || 'Не удалось выполнить вход.');
      } finally {
        submit.disabled = false;
      }
    });

    registerForm.addEventListener('submit', async event => {
      event.preventDefault();
      const name = document.getElementById('registerName').value.trim();
      const email = document.getElementById('registerEmail').value.trim();
      const password = document.getElementById('registerPassword').value;
      const confirm = document.getElementById('registerConfirm').value;
      const agreement = document.getElementById('registerAgree').checked;
      ['registerName', 'registerEmail', 'registerPassword', 'registerConfirm', 'registerAgree']
        .forEach(id => setFieldError(id, ''));
      setFormMessage('registerForm', '');
      let valid = true;
      if (name.length < 2) {
        setFieldError('registerName', 'Укажите имя не короче 2 символов.');
        valid = false;
      }
      if (!/^\S+@\S+\.\S+$/.test(email)) {
        setFieldError('registerEmail', 'Введите корректный email.');
        valid = false;
      }
      if (password.length < 6) {
        setFieldError('registerPassword', 'Минимум 6 символов.');
        valid = false;
      }
      if (password !== confirm || !confirm) {
        setFieldError('registerConfirm', 'Пароли должны совпадать.');
        valid = false;
      }
      if (!agreement) {
        setFieldError('registerAgree', 'Необходимо согласиться с учебными правилами.');
        valid = false;
      }
      if (!valid) return;
      const submit = registerForm.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        const result = await registerUser(name, email, password);
        if (!result.ok) return setFormMessage('registerForm', result.error);
        window.location.href = destination();
      } catch (error) {
        setFormMessage('registerForm', error.message || 'Не удалось сохранить аккаунт.');
      } finally {
        submit.disabled = false;
      }
    });
  }

  function initCabinet() {
    const content = document.getElementById('cabinetContent');
    if (!content) return;
    const denied = document.getElementById('cabinetDenied');
    const user = getSession();
    denied.hidden = Boolean(user);
    content.hidden = !user;
    if (!user) return;
    document.getElementById('profileName').textContent = user.name;
    document.getElementById('profileEmail').textContent = user.email;
    document.getElementById('profileDate').textContent = new Date(user.createdAt).toLocaleDateString('ru-RU', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
    document.getElementById('avatarInitial').textContent = user.name.charAt(0).toUpperCase();
    renderCabinetFavorites();
  }

  function renderCabinetFavorites() {
    const grid = document.getElementById('cabinetFavorites');
    if (!grid) return;
    const user = getSession();
    if (!user) return;
    const ids = getFavorites(user.id);
    const favorites = window.OrbitaData.PLANETS.filter(planet => ids.includes(planet.id));
    document.getElementById('favoritesCount').textContent = String(favorites.length);
    const empty = document.getElementById('cabinetEmpty');
    empty.hidden = favorites.length > 0;
    grid.innerHTML = favorites.map(planet => `
      <article class="favorite-card">
        <img src="${planet.image}" alt="Планета ${planet.name}" width="94" height="94" loading="lazy">
        <div class="favorite-card__content">
          <span class="eyebrow muted">${planet.category}</span>
          <h3>${planet.name}</h3>
          <p>${planet.subtitle}</p>
        </div>
        <button class="icon-button favorite-card__remove" type="button" data-remove-favorite="${planet.id}" aria-label="Убрать ${planet.name} из избранного" title="Убрать из избранного">×</button>
      </article>
    `).join('');
    grid.querySelectorAll('[data-remove-favorite]').forEach(button => button.addEventListener('click', () => {
      toggleFavorite(button.dataset.removeFavorite);
      renderCabinetFavorites();
    }));
  }

  document.addEventListener('DOMContentLoaded', () => {
    updateHeader();
    initMenu();
    initAuthPage();
    initCabinet();
    document.querySelectorAll('[data-logout]').forEach(button => button.addEventListener('click', logout));
  });

  window.OrbitaAuth = Object.freeze({
    getSession, getFavorites, toggleFavorite, updateHeader, logout
  });
})();
