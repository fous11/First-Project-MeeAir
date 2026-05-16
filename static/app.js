// ============================================================
// Глобальное состояние
// ============================================================
const RATES = { EUR: 1, USD: 1.08, RUB: 100 };
const SYMBOLS = { EUR: '€', USD: '$', RUB: '₽' };
let currentCurrency = 'EUR';
let currentUser = null;
let airports = [];
let lastResults = [];
let bookingState = {
  flight: null,
  cls: null,
  seat: null,
  services: {},
  step: 1,
};
const classMult = { eco:1, mid:1.35, biz:2.1 };
const classNames = { eco:'Эконом', mid:'Комфорт', biz:'Бизнес' };
const SERVICE_PRICES = { bag:25, ins:15, meal:10, wifi:8, priority:20 };
const svcNames = { bag:'Багаж 20 кг', ins:'Страховка', meal:'Горячее питание', wifi:'Wi-Fi', priority:'Приоритетная посадка' };
let searchMode = 'one';
let takenSeats = [];
let editBookingState = { id: null, services: {}, basePrice: 0, passengers: 1, flightClass: 'eco' };
const classFeatures = {
  eco: [
    { ok: true, text: 'Ручная кладь 7 кг' },
    { ok: true, text: 'Стандартное кресло' },
    { ok: false, text: 'Багаж не включён' },
    { ok: false, text: 'Питание не включено' },
  ],
  mid: [
    { ok: true, text: 'Ручная кладь 10 кг' },
    { ok: true, text: 'Увеличенное пространство (+5 см)' },
    { ok: true, text: 'Выбор места включён' },
    { ok: false, text: 'Питание не включено' },
  ],
  biz: [
    { ok: true, text: 'Ручная кладь 15 кг + багаж 23 кг' },
    { ok: true, text: 'Широкое кресло с увеличенным пространством' },
    { ok: true, text: 'Питание и напитки включены' },
    { ok: true, text: 'Приоритетная посадка включена' },
  ],
};

function renderClassFeatures(cls) {
  const el = document.getElementById('classFeatures');
  if (!el || !classFeatures[cls]) return;
  el.innerHTML = '<ul class="class-features-list">' + classFeatures[cls].map(f =>
    `<li class="${f.ok ? 'feat-yes' : 'feat-no'}">${f.text}</li>`
  ).join('') + '</ul>';
}

function userFromApi(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.is_admin ? 'admin' : 'user',
    phone: user.phone || '',
    currency: user.currency || 'EUR',
    avatar_color: user.avatar_color || '#1e90d4',
  };
}

function applyAvatarColor(color) {
  const c = color || '#1e90d4';
  const av = document.getElementById('userAvatar');
  const preview = document.getElementById('profileAvatarPreview');
  if (av) av.style.background = c;
  if (preview) {
    preview.style.background = c;
    preview.textContent = (currentUser?.name || '?').slice(0, 2).toUpperCase();
  }
  document.querySelectorAll('#avatarColorPicker .color-swatch').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.color === c);
  });
}

function pickAvatarColor(color, btn) {
  if (!currentUser) return;
  currentUser.avatar_color = color;
  applyAvatarColor(color);
  if (btn) {
    document.querySelectorAll('#avatarColorPicker .color-swatch').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
}
let editingFlightId = null;
let editingAirportCode = null;
let confirmCallback = null;

// ============================================================
// API-обёртка
// ============================================================
async function api(url, options = {}) {
  // Автоматически подставляем текущий хост (работает и на localhost, и во внешней сети)
  const fullUrl = url.startsWith('http') ? url : window.location.origin + url;

  const res = await fetch(fullUrl, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Network error' }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

// ============================================================
// Инициализация после загрузки страницы
// ============================================================
window.addEventListener('load', async () => {
  try {
    airports = await api('/api/airports');
  } catch (e) {
    console.warn('Не удалось загрузить аэропорты, используются пустые');
  }
  populateAirportSelects();

  const today = new Date().toISOString().split('T')[0];
  const d = new Date(); d.setDate(d.getDate() + 7);
  const depInput = document.getElementById('depDate');
  const retInput = document.getElementById('retDate');
  if (depInput) {
    depInput.value = d.toISOString().split('T')[0];
    depInput.setAttribute('min', today);
    depInput.addEventListener('change', () => {
      if (retInput) retInput.setAttribute('min', depInput.value || today);
    });
  }
  if (retInput) retInput.setAttribute('min', today);

  try {
    const ratesData = await api('/api/rates');
    if (ratesData.USD) RATES.USD = ratesData.USD;
    if (ratesData.RUB) RATES.RUB = ratesData.RUB;
  } catch (e) {}

  try {
    const user = await api('/api/auth/me');
    if (user) {
      currentUser = userFromApi(user);
      updateNavUser();
    }
  } catch (e) {}

  setTimeout(() => {
    const loader = document.getElementById('pageLoader');
    if (loader) {
      loader.style.opacity = '0';
      setTimeout(() => { loader.style.display = 'none'; }, 500);
    }
  }, 900);
});

// ============================================================
// Валюты
// ============================================================
function fmtPrice(eur) {
  const val = eur * RATES[currentCurrency];
  return SYMBOLS[currentCurrency] + Math.round(val);
}

function updateCurrency() {
  currentCurrency = document.getElementById('currencySelect')?.value || 'EUR';
  ['svcBagPrice','svcInsPrice','svcMealPrice','svcSeatPrice'].forEach((id,i) => {
    const el = document.getElementById(id);
    if (el) el.textContent = fmtPrice([25,15,10,12][i]);
  });
  const svcMap = {bag:25, ins:15, meal:10, wifi:8, priority:20};
  Object.keys(svcMap).forEach(k => {
    const el = document.getElementById('svc-'+k+'-price');
    if (el) el.textContent = '+'+fmtPrice(svcMap[k]);
  });
  recalcTotal();
  if (lastResults.length) renderFlights(lastResults);
  if (bookingState.flight) updateClassPrices();
}

async function saveRates() {
  RATES.USD = parseFloat(document.getElementById('rateUSD').value) || 1.08;
  RATES.RUB = parseFloat(document.getElementById('rateRUB').value) || 100;
  try {
    await api('/api/rates', {
      method: 'PUT',
      body: JSON.stringify({ USD: RATES.USD, RUB: RATES.RUB }),
    });
    updateCurrency();
    notify('Курсы сохранены', 'success');
  } catch (e) {
    notify('Ошибка сохранения курсов', 'error');
  }
}

// ============================================================
// Аэропорты (заполнение select'ов)
// ============================================================
function populateAirportSelects() {
  const selects = ['fromAirport','toAirport','feFrom','feTo'];
  selects.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const prevVal = el.value;
    el.innerHTML = '<option value="">Выберите аэропорт</option>';
    airports.forEach(a => {
      el.innerHTML += `<option value="${a.code}">${a.city} (${a.code})</option>`;
    });
    if (prevVal) el.value = prevVal;
  });
}

// ============================================================
// Поиск рейсов
// ============================================================
function getPassengers() {
  return parseInt(document.getElementById('passengers')?.value || '1', 10) || 1;
}

async function searchFlights() {
  const from = document.getElementById('fromAirport').value;
  const to = document.getElementById('toAirport').value;
  const depDate = document.getElementById('depDate').value;
  const retDate = document.getElementById('retDate').value;
  const passengers = getPassengers();

  if (!from || !to) { notify('Выберите аэропорты', 'error'); return; }
  if (from === to) { notify('Аэропорты совпадают', 'error'); return; }
  if (!depDate) { notify('Выберите дату вылета', 'error'); return; }
  if (searchMode === 'round' && retDate && retDate <= depDate) {
    notify('Дата возврата должна быть позже даты вылета', 'error');
    return;
  }

  const btn = document.querySelector('.btn-search');
  if (btn) { btn.disabled = true; btn.textContent = 'Поиск...'; }

  try {
    const results = await api(`/api/flights?from=${from}&to=${to}`);
    lastResults = results;
    renderFlights(lastResults);

    const flightsSection = document.getElementById('flights');
    flightsSection.style.display = 'block';
    const fromCity = airports.find(a => a.code === from)?.city || from;
    const toCity = airports.find(a => a.code === to)?.city || to;
    let summary = `${fromCity} → ${toCity} · ${formatDateRu(depDate)}`;
    if (searchMode === 'round' && retDate) summary += ` — ${formatDateRu(retDate)}`;
    summary += ` · ${passengers} пасс. · Найдено: ${lastResults.length}`;
    document.getElementById('searchSummary').textContent = summary;

    setTimeout(() => {
      flightsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  } catch (e) {
    notify('Ошибка поиска рейсов', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Найти рейсы'; }
  }
}

function formatDateRu(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}


function renderFlights(results) {
  const list = document.getElementById('flightsList');
  if (!results || results.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon empty-icon-plane"></div><p>Рейсы не найдены</p><span>Попробуйте другие аэропорты</span></div>`;
    return;
  }
  list.innerHTML = results.map(f => {
    const totalSeats = f.seats_eco + f.seats_mid + f.seats_biz;
    const lowSeats = totalSeats > 0 && totalSeats < 6;
    const soldOut = totalSeats === 0;
    const fromLabel = f.from_city || f.from;
    const toLabel = f.to_city || f.to;
    const pax = getPassengers();
    const priceFrom = f.base_price * pax;
    return `
    <div class="flight-card${soldOut ? ' flight-sold-out' : ''}" ${soldOut ? '' : `onclick="openBooking(${f.id})"`}>
      <div class="airline-info">
        <div class="airline-icon">${f.airline.slice(0,2).toUpperCase()}</div>
        <div><div class="airline-name">${f.airline}</div><div class="flight-num">${f.flight_number}</div></div>
      </div>
      <div class="time-block"><div class="time">${f.departure_time}</div><div class="airport">${fromLabel}</div></div>
      <div class="route-line">
        <div class="duration">${f.duration}</div>
        <div class="line"><div class="line-dot"></div><div class="line-bar"></div><div class="line-dot"></div></div>
        <div class="direct">Прямой</div>
      </div>
      <div class="time-block"><div class="time">${f.arrival_time}</div><div class="airport">${toLabel}</div></div>
      <div>
        ${soldOut ? '<div class="seats-badge seats-sold">Нет мест</div>' : lowSeats ? `<div class="seats-badge">Осталось ${totalSeats} мест</div>` : ''}
        <div class="class-badges">
          ${f.seats_eco>0 ? '<span class="class-badge class-eco">Эконом</span>' : ''}
          ${f.seats_mid>0 ? '<span class="class-badge class-mid">Комфорт</span>' : ''}
          ${f.seats_biz>0 ? '<span class="class-badge class-biz">Бизнес</span>' : ''}
        </div>
        <div class="price-block" style="margin-top:4px">
          <div class="price">${fmtPrice(priceFrom)}</div>
          <div class="price-label">от / эконом${pax > 1 ? ' · ' + pax + ' пасс.' : ''}</div>
        </div>
      </div>
      ${soldOut
        ? '<button type="button" class="btn-book btn-book-disabled" disabled>Нет мест</button>'
        : `<button type="button" class="btn-book" onclick="event.stopPropagation(); openBooking(${f.id})">Выбрать</button>`}
    </div>`;
  }).join('');
}

// ============================================================
// Бронирование
// ============================================================
async function openBooking(flightId) {
  if (!currentUser) { notify('Войдите для бронирования', 'error'); openAuthModal('login'); return; }
  const fid = Number(flightId);
  const f = lastResults.find(x => x.id === fid) || bookingState.flight;
  if (!f) { notify('Рейс не найден', 'error'); return; }
  const totalSeats = (f.seats_eco || 0) + (f.seats_mid || 0) + (f.seats_biz || 0);
  if (totalSeats === 0) { notify('На этом рейсе нет свободных мест', 'error'); return; }

  bookingState = { flight: f, cls: null, seat: null, services: {}, step: 1 };

  const depDate = document.getElementById('depDate').value;
  const fromLabel = f.from_city || f.from;
  const toLabel = f.to_city || f.to;
  document.getElementById('bookingFlightInfo').textContent =
    `${fromLabel} → ${toLabel} · ${f.flight_number} · ${depDate ? formatDateRu(depDate) + ' · ' : ''}${f.departure_time}–${f.arrival_time}`;
  updateClassPrices();
  gotoBookingStep(1);
  document.getElementById('successScreen').classList.remove('show');
  ['bag','ins','meal','wifi','priority'].forEach(k => {
    const el = document.getElementById('svc-'+k);
    if (el) el.classList.remove('checked');
    const cb = document.getElementById('cb-'+k);
    if (cb) cb.classList.remove('on');
  });
  document.getElementById('passengerName').value = currentUser.name || '';
  document.getElementById('passengerEmail').value = currentUser.email || '';
  document.getElementById('passengerPhone').value = currentUser.phone || '';
  takenSeats = f.taken_seats || [];
  try {
    const seatsData = await api('/api/flights/' + flightId + '/seats');
    takenSeats = seatsData.taken || takenSeats;
  } catch (e) {}
  ['cardNumber','cardExpiry','cardCvv'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('bookingModal').classList.add('show');
}

function updateClassPrices() {
  const f = bookingState.flight;
  if (!f) return;
  document.getElementById('cls-eco-price').textContent = fmtPrice(f.base_price);
  document.getElementById('cls-mid-price').textContent = fmtPrice(Math.round(f.base_price * classMult.mid));
  document.getElementById('cls-biz-price').textContent = fmtPrice(Math.round(f.base_price * classMult.biz));
}

function selectClass(cls) {
  bookingState.cls = cls;
  document.querySelectorAll('.class-option').forEach(el => el.classList.remove('selected','selected-gold'));
  const el = document.getElementById('cls-'+cls);
  el.classList.add(cls === 'biz' ? 'selected-gold' : 'selected');
  renderClassFeatures(cls);
  recalcTotal();
}

function gotoBookingStep(step) {
  if (step === 2 && !bookingState.cls) { notify('Выберите класс обслуживания', 'error'); return; }
  if (step === 3 && !bookingState.seat) { notify('Выберите место', 'error'); return; }
  bookingState.step = step;
  document.querySelectorAll('.booking-pane').forEach((el,i) => el.classList.toggle('active', i+1 === step));
  for (let i = 1; i <= 4; i++) {
    const s = document.getElementById('bstep'+i);
    s.classList.remove('active','done');
    if (i < step) s.classList.add('done');
    if (i === step) s.classList.add('active');
  }
  if (step === 2) renderSeatMap();
  if (step === 4) renderBookingSummary();
}

function renderSeatMap() {
  let html = '';
  const cols = ['A','B','C','','D','E','F'];
  for (let row = 1; row <= 25; row++) {
    html += `<div class="seat-row"><span class="seat-row-num">${row}</span>`;
    cols.forEach(col => {
      if (!col) { html += '<div class="seat-aisle"></div>'; return; }
      const id = `${row}${col}`;
      const taken = takenSeats.includes(id);
      const selected = bookingState.seat === id;
      html += `<div class="seat seat-${row<=3?'biz':row<=7?'mid':'eco'}${taken?' seat-taken':''}${selected?' seat-selected':''}" onclick="${taken?'':'selectSeat(\''+id+'\')'}"><span>${col}</span></div>`;
    });
    html += '</div>';
  }
  document.getElementById('seatMapBody').innerHTML = html;
}

function selectSeat(id) {
  bookingState.seat = id;
  const row = parseInt(id);
  const seatClass = row <= 3 ? 'biz' : row <= 7 ? 'mid' : 'eco';
  if (bookingState.cls && seatClass !== bookingState.cls) {
    notify(`Это место класса «${classNames[seatClass]}». Вы выбрали «${classNames[bookingState.cls]}»`, 'error');
    bookingState.seat = null;
    return;
  }
  renderSeatMap();
  const info = document.getElementById('seatSelectedInfo');
  if (info) info.innerHTML = bookingState.seat
    ? 'Выбрано место: <strong>' + id + '</strong> (' + classNames[seatClass] + ')'
    : '';
}

function toggleService(key, baseEur) {
  if (bookingState.services[key]) {
    delete bookingState.services[key];
    document.getElementById('svc-'+key).classList.remove('checked');
    document.getElementById('cb-'+key).classList.remove('on');
  } else {
    bookingState.services[key] = baseEur;
    document.getElementById('svc-'+key).classList.add('checked');
    document.getElementById('cb-'+key).classList.add('on');
  }
  recalcTotal();
}

function recalcTotal() {
  const f = bookingState.flight;
  if (!f) return 0;
  const cls = bookingState.cls || 'eco';
  const basePrice = Math.round(f.base_price * classMult[cls]);
  const svcSum = Object.values(bookingState.services).reduce((a,b)=>a+b,0);
  const total = (basePrice + svcSum) * getPassengers();
  const el = document.getElementById('totalAmount');
  if (el) el.textContent = fmtPrice(total);
  return total;
}

function renderBookingSummary() {
  const f = bookingState.flight;
  const cls = bookingState.cls;
  const basePrice = Math.round(f.base_price * classMult[cls]);
  const svcNames = { bag:'Багаж 20 кг', ins:'Страховка', meal:'Горячее питание', wifi:'Wi-Fi', priority:'Приоритетная посадка' };
  const svcPrices = { bag:25, ins:15, meal:10, wifi:8, priority:20 };
  const fromL = f.from_city || f.from;
  const toL = f.to_city || f.to;
  let html = `
    <div><strong>Маршрут:</strong> ${fromL} → ${toL} · ${f.flight_number}</div>
    <div><strong>Время:</strong> ${f.departure_time} – ${f.arrival_time} · ${f.duration}</div>
    <div><strong>Класс:</strong> ${classNames[cls]} · Место: <strong>${bookingState.seat || 'не выбрано'}</strong></div>
    <div><strong>Тариф:</strong> ${fmtPrice(basePrice)} × ${getPassengers()} пасс.</div>`;
  Object.keys(bookingState.services).forEach(k => {
    html += `<div><strong>Услуга:</strong> ${svcNames[k]}: +${fmtPrice(svcPrices[k])}</div>`;
  });
  document.getElementById('bookingSummary').innerHTML = html;
}

async function confirmBooking() {
  const name = document.getElementById('passengerName').value.trim();
  const email = document.getElementById('passengerEmail').value.trim();
  const phone = document.getElementById('passengerPhone').value.trim();
  const departureDate = document.getElementById('depDate').value; // YYYY-MM-DD
  if (!name) { notify('Введите имя пассажира', 'error'); return; }
  if (!email) { notify('Введите email', 'error'); return; }
  const cardErr = validateCard();
  if (cardErr) { notify(cardErr, 'error'); return; }
  if (!bookingState.cls || !bookingState.seat) { notify('Завершите выбор класса и места', 'error'); return; }

  const total = recalcTotal();
  const btn = document.getElementById('btnConfirmBooking');
  if (btn) { btn.disabled = true; btn.textContent = 'Обработка...'; }
  try {
    const result = await api('/api/bookings', {
      method: 'POST',
      body: JSON.stringify({
        flight_id: bookingState.flight.id,
        class: bookingState.cls,
        seat: bookingState.seat,
        services: Object.keys(bookingState.services),
        passenger_name: name,
        email: email,
        phone: phone,
        total_price: total,
        departure_date: departureDate,
        return_date: searchMode === 'round' ? (document.getElementById('retDate').value || null) : null,
        passengers: getPassengers(),
      }),
    });
    document.getElementById('successRef').textContent = result.ref;
    document.getElementById('successDetails').innerHTML =
      `<strong>${name}</strong><br>Билет ${result.ref} · ${formatDateRu(departureDate)}<br>Отправлен на ${email}`;
    document.querySelectorAll('.booking-pane').forEach(p => p.classList.remove('active'));
    document.getElementById('successScreen').classList.add('show');
    const from = document.getElementById('fromAirport').value;
    const to = document.getElementById('toAirport').value;
    if (from && to) {
      lastResults = await api(`/api/flights?from=${from}&to=${to}`);
      renderFlights(lastResults);
    }
  } catch (e) {
    notify(e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Оплатить и подтвердить'; }
  }
}

// ============================================================
// Авторизация
// ============================================================
function openAuthModal(tab) { document.getElementById('authModal').classList.add('show'); switchAuthTab(tab); }
function switchAuthTab(tab) {
  document.getElementById('loginPane').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('registerPane').style.display = tab === 'register' ? 'block' : 'none';
  document.getElementById('loginTab').classList.toggle('active', tab === 'login');
  document.getElementById('registerTab').classList.toggle('active', tab === 'register');
  document.getElementById('authTitle').textContent = tab === 'login' ? 'Вход в аккаунт' : 'Регистрация';
  document.getElementById('loginError').textContent = '';
  document.getElementById('registerError').textContent = '';
}
async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  try {
    const user = await api('/api/auth/login', { method:'POST', body: JSON.stringify({email, password}) });
    currentUser = userFromApi(user);
    updateNavUser();
    closeModal('authModal');
    notify(`Добро пожаловать, ${user.name}!`, 'success');
  } catch (e) { document.getElementById('loginError').textContent = e.message; }
}

async function doRegister() {
  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const password2 = document.getElementById('regPassword2').value;

  // Валидация полей
  if (!name || !email || !password) {
    document.getElementById('registerError').textContent = 'Заполните все поля';
    return;
  }
  if (password !== password2) {
    document.getElementById('registerError').textContent = 'Пароли не совпадают';
    return;
  }
  if (password.length < 6) {
    document.getElementById('registerError').textContent = 'Минимум 6 символов';
    return;
  }

  // Простая проверка формата email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    document.getElementById('registerError').textContent = 'Некорректный email-адрес';
    return;
  }

  // Дополнительно: запрещаем email без доменной точки (уже покрыто регексом)
  // и слишком короткие домены
  const parts = email.split('@');
  if (parts.length !== 2 || parts[1].length < 3 || !parts[1].includes('.')) {
    document.getElementById('registerError').textContent = 'Некорректный email-адрес';
    return;
  }

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: name, email, password })
    });
    const data = await res.json();

    if (res.ok) {
      // Показываем форму ввода кода
      showCodeConfirmation(email, data.code);
    } else {
      document.getElementById('registerError').textContent = data.error || 'Ошибка регистрации';
    }
  } catch (e) {
    document.getElementById('registerError').textContent = 'Сетевая ошибка';
  }
}

function showCodeConfirmation(email, demoCode) {
  // Скрываем регистрационную форму
  document.getElementById('registerPane').style.display = 'none';

  // Создаём блок для ввода кода
  const authModalBody = document.querySelector('#authModal .modal-body');
  const codePane = document.createElement('div');
  codePane.id = 'codePane';
  codePane.innerHTML = `
    <p style="margin-bottom:1rem;color:var(--gray-600);">
      На email <strong>${email}</strong> отправлен код подтверждения.<br>
      <em style="font-size:0.8rem;">(Для демо показываем в уведомлении: ${demoCode})</em>
    </p>
    <label class="form-label">Код из 6 цифр</label>
    <input type="text" class="form-input" id="confirmCode" maxlength="6" placeholder="000000">
    <div class="form-error" id="confirmError"></div>
    <button class="btn-primary" onclick="confirmEmail('${email}')">Подтвердить</button>
  `;
  authModalBody.appendChild(codePane);
  notify(`Демо-код: ${demoCode}`, 'success');
}

async function confirmEmail(email) {
  const code = document.getElementById('confirmCode').value.trim();
  if (!code || code.length !== 6) {
    document.getElementById('confirmError').textContent = 'Введите 6 цифр';
    return;
  }

  try {
    const res = await fetch('/api/auth/confirm-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code })
    });
    const data = await res.json();

    if (res.ok) {
      currentUser = userFromApi(data);
      updateNavUser();
      closeModal('authModal');
      // Удалим панель кода при закрытии (или можно просто сбросить)
      const codePane = document.getElementById('codePane');
      if (codePane) codePane.remove();
      notify(`Добро пожаловать, ${data.name}!`, 'success');
    } else {
      document.getElementById('confirmError').textContent = data.error || 'Ошибка подтверждения';
    }
  } catch (e) {
    document.getElementById('confirmError').textContent = 'Сетевая ошибка';
  }
}

// При переключении вкладок или закрытии модалки убираем панель кода
function resetCodePane() {
  const codePane = document.getElementById('codePane');
  if (codePane) codePane.remove();
}
// Добавим очистку при переключении на логин/регистрацию
const origSwitchAuthTab = switchAuthTab;
window.switchAuthTab = function(tab) {
  resetCodePane();
  origSwitchAuthTab(tab);
};

async function logout() { await api('/api/auth/logout'); currentUser = null; updateNavUser(); showPage('home'); }
function updateNavUser() {
  const guest = document.getElementById('navGuest');
  const user = document.getElementById('navUser');
  if (currentUser) {
    guest.style.display = 'none'; user.style.display = 'flex';
    document.getElementById('userAvatar').textContent = currentUser.name.slice(0, 2).toUpperCase();
    document.getElementById('userName').textContent = currentUser.name;
    document.getElementById('adminBadge').style.display = currentUser.role === 'admin' ? 'inline' : 'none';
    document.getElementById('adminLink').style.display = currentUser.role === 'admin' ? 'flex' : 'none';
    applyAvatarColor(currentUser.avatar_color);
    const curSel = document.getElementById('currencySelect');
    if (curSel && currentUser.currency) {
      curSel.value = currentUser.currency;
      currentCurrency = currentUser.currency;
    }
  } else {
    guest.style.display = 'flex';
    user.style.display = 'none';
  }
}

function toggleDropdown() {
  const menu = document.getElementById('dropdownMenu');
  if (!menu) return;
  menu.classList.toggle('open');
}

// Сбрасываем инлайн-стили при ресайзе на десктоп
window.addEventListener('resize', () => {
  const menu = document.getElementById('dropdownMenu');
  if (menu && window.innerWidth >= 992) {
    menu.style.position = '';
    menu.style.top = '';
    menu.style.left = '';
    menu.style.transform = '';
    menu.style.right = '';
  }
});

function closeMenu() {
  const menu = document.getElementById('dropdownMenu');
  if (menu) menu.classList.remove('open');
}

// Закрытие меню при клике вне его
document.addEventListener('click', function(e) {
  const menu = document.getElementById('dropdownMenu');
  if (menu && menu.classList.contains('open')) {
    // Если кликнули не по элементам внутри .dropdown – закрываем
    if (!e.target.closest('.dropdown')) {
      menu.classList.remove('open');
    }
  }
});

// ============================================================
// Страницы и билеты
// ============================================================
function showPage(name, opts) {
  const map = { home:'pageHome', tickets:'pageTickets', profile:'pageProfile', admin:'pageAdmin' };
  const targetPage = document.getElementById(map[name]);
  const currentActive = document.querySelector('.page.active');
  const samePage = currentActive && currentActive === targetPage;

  if (samePage && !(opts && opts.force)) {
    if (opts && opts.scrollTop) window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  if (targetPage) targetPage.classList.add('active');
  window.scrollTo(0, 0);
}
function scrollToSearch() { showPage('home'); setTimeout(() => document.getElementById('searchBox').scrollIntoView({behavior:'smooth'}), 100); }
async function showMyTickets() {
  if (!currentUser) { openAuthModal('login'); return; }
  showPage('tickets');
  try { renderMyTickets(await api('/api/bookings')); } catch (e) { notify('Ошибка загрузки', 'error'); }
  document.getElementById('dropdownMenu').classList.remove('open');
}
function renderMyTickets(bookings) {
  const list = document.getElementById('ticketsList');
  if (!bookings.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">&#9992;</div><p>У вас пока нет билетов</p><span>Забронируйте рейс на главной</span></div>';
    return;
  }
  list.innerHTML = bookings.map(b => {
    const svc = (b.service_labels && b.service_labels.length) ? b.service_labels.join(', ') : '—';
    return `
    <div class="ticket-card" id="ticket-${b.id}">
      <div class="ticket-header">
        <div>
          <div class="ticket-route">${b.route}</div>
          <div class="ticket-meta">${b.airline || ''} · ${b.flight_number}${b.departure_date ? ' · ' + b.departure_date : ''}</div>
        </div>
        <span class="ticket-ref">${b.ref}</span>
      </div>
      <div class="ticket-details">
        <div><label>Класс</label><span>${classNames[b.class]}</span></div>
        <div><label>Место</label><span>${b.seat || '—'}</span></div>
        <div><label>Пассажиры</label><span>${b.passengers || 1}</span></div>
        <div><label>Услуги</label><span>${svc}</span></div>
        <div><label>Сумма</label><span class="ticket-price">${fmtPrice(b.total_price)}</span></div>
      </div>
      <div class="ticket-actions">
        ${b.can_edit
          ? `<button class="btn-edit" onclick="editBooking(${b.id})">Изменить услуги</button>
             <button class="btn-delete" onclick="cancelBooking(${b.id})">Отменить</button>`
          : '<span class="ticket-status">Редактирование недоступно</span>'}
      </div>
    </div>`;
  }).join('');
}
function showProfile() {
  if (!currentUser) return;
  showPage('profile');
  document.getElementById('profileName').value = currentUser.name;
  document.getElementById('profileEmail').value = currentUser.email;
  document.getElementById('profilePhone').value = currentUser.phone || '';
  document.getElementById('profileCurrency').value = currentUser.currency || 'EUR';
  document.getElementById('profilePassword').value = '';
  applyAvatarColor(currentUser.avatar_color);
  document.getElementById('dropdownMenu').classList.remove('open');
}
async function saveProfile() {
  try {
    const password = document.getElementById('profilePassword').value;
    const payload = {
      name: document.getElementById('profileName').value.trim(),
      phone: document.getElementById('profilePhone').value.trim(),
      currency: document.getElementById('profileCurrency').value,
      avatar_color: currentUser.avatar_color || '#1e90d4',
    };
    if (password) payload.password = password;
    await api('/api/profile', { method: 'PUT', body: JSON.stringify(payload) });
    currentUser.name = payload.name;
    currentUser.phone = payload.phone;
    currentUser.currency = payload.currency;
    currentCurrency = payload.currency;
    updateNavUser();
    notify('Профиль сохранён', 'success');
  } catch (e) { notify(e.message || 'Ошибка', 'error'); }
}

async function editBooking(bookingId) {
  try {
    const booking = await api(`/api/bookings/${bookingId}`);
    if (!booking.can_edit) {
      notify('Редактирование недоступно', 'error');
      return;
    }
    editBookingState = {
      id: bookingId,
      services: {},
      basePrice: Math.round(booking.base_price * classMult[booking.class]),
      passengers: booking.passengers || 1,
      flightClass: booking.class,
    };
    (booking.services || []).forEach(k => {
      if (SERVICE_PRICES[k]) editBookingState.services[k] = SERVICE_PRICES[k];
    });
    let html = '<p style="margin-bottom:1rem;color:var(--gray-600);">Рейс ' + booking.route + ' · ' + classNames[booking.class] + '</p>';
    Object.keys(SERVICE_PRICES).forEach(k => {
      const on = editBookingState.services[k];
      html += '<div class="service-check' + (on ? ' checked' : '') + '" id="edit-svc-' + k + '" onclick="toggleEditService(\'' + k + '\')">';
      html += '<div class="svc-left"><div class="svc-name">' + svcNames[k] + '</div></div>';
      html += '<span class="svc-price">+' + fmtPrice(SERVICE_PRICES[k]) + '</span></div>';
    });
    html += '<div style="margin:1rem 0;padding:1rem;background:var(--gray-100);border-radius:10px;display:flex;justify-content:space-between;">';
    html += '<span>Новая сумма</span><strong id="editTotalDisplay">' + fmtPrice(calcEditTotal()) + '</strong></div>';
    html += '<button class="btn-primary" onclick="saveBookingEdits(' + bookingId + ')">Сохранить</button>';
    document.getElementById('editBookingModal').querySelector('.modal-body').innerHTML = html;
    document.getElementById('editBookingModal').classList.add('show');
  } catch (e) {
    notify('Ошибка загрузки билета', 'error');
  }
}

async function saveBookingEdits(bookingId) {
  const selected = Object.keys(editBookingState.services);
  try {
    const result = await api(`/api/bookings/${bookingId}`, {
      method: 'PUT',
      body: JSON.stringify({ services: selected })
    });
    notify('Билет обновлён', 'success');
    closeModal('editBookingModal');
    showMyTickets(); // обновить список
  } catch (e) {
    notify(e.message || 'Ошибка', 'error');
  }
}

async function cancelBooking(bookingId) {
  if (!confirm('Вы уверены, что хотите отменить билет?')) return;

  try {
    await api(`/api/bookings/${bookingId}`, { method: 'DELETE' });
    notify('Билет отменён', 'success');
    showMyTickets();
  } catch (e) {
    notify(e.message || 'Ошибка', 'error');
  }
}

function validateCard() {
  const num = (document.getElementById('cardNumber').value || '').replace(/\s/g, '');
  const exp = document.getElementById('cardExpiry').value || '';
  const cvv = document.getElementById('cardCvv').value || '';
  if (num.length < 16) return 'Введите номер карты (16 цифр)';
  if (!/^\d{2}\/\d{2}$/.test(exp)) return 'Формат срока: ММ/ГГ';
  if (cvv.length < 3) return 'Введите CVV';
  return null;
}

function loadRatesUI() {
  const usd = document.getElementById('rateUSD');
  const rub = document.getElementById('rateRUB');
  if (usd) usd.value = RATES.USD;
  if (rub) rub.value = RATES.RUB;
}

function calcEditTotal() {
  const svc = Object.values(editBookingState.services).reduce((a, b) => a + b, 0);
  return (editBookingState.basePrice + svc) * (editBookingState.passengers || 1);
}

function updateEditTotal() {
  const el = document.getElementById('editTotalDisplay');
  if (el) el.textContent = fmtPrice(calcEditTotal());
}

function toggleEditService(key) {
  const el = document.getElementById('edit-svc-' + key);
  if (editBookingState.services[key]) {
    delete editBookingState.services[key];
    if (el) el.classList.remove('checked');
  } else {
    editBookingState.services[key] = SERVICE_PRICES[key];
    if (el) el.classList.add('checked');
  }
  updateEditTotal();
}

// ============================================================
// АДМИН-ПАНЕЛЬ (ПОЛНОСТЬЮ РАБОЧАЯ)
// ============================================================
async function showAdminPanel() {
  if (!currentUser || currentUser.role !== 'admin') { notify('Нет доступа', 'error'); return; }
  showPage('admin');
  await loadAdminStats();
  await loadAdminFlights();
  await loadAdminAirports();
  await loadAdminUsers();
  await loadAdminBookings();
  loadRatesUI();
  document.getElementById('dropdownMenu').classList.remove('open');
}

function switchAdminTab(tab, btn) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.admin-content').forEach(c => c.classList.remove('active'));
  const tabEl = document.getElementById('admin'+tab.charAt(0).toUpperCase()+tab.slice(1));
  if (tabEl) tabEl.classList.add('active');
}


// Статистика
async function loadAdminStats() {
  try {
    const stats = await api('/api/admin/stats');
    document.getElementById('adminStatsGrid').innerHTML = `
      <div class="stat-card"><div class="stat-card-icon"></div><div class="stat-card-num">${stats.total_flights}</div><div class="stat-card-label">Рейсов</div></div>
      <div class="stat-card"><div class="stat-card-icon"></div><div class="stat-card-num">${stats.total_users}</div><div class="stat-card-label">Пользователей</div></div>
      <div class="stat-card"><div class="stat-card-icon"></div><div class="stat-card-num">${stats.total_bookings}</div><div class="stat-card-label">Бронирований</div></div>
      <div class="stat-card"><div class="stat-card-icon"></div><div class="stat-card-num">${fmtPrice(stats.revenue)}</div><div class="stat-card-label">Выручка</div></div>
    `;
    const tbody = document.querySelector('#adminRecentBookings tbody');
    tbody.innerHTML = stats.recent_bookings.map(b => `
      <tr>
        <td>${b.ref}</td><td>${b.passenger_name}</td><td>${b.route}</td>
        <td>${classNames[b.class]}</td><td>${b.seat||'—'}</td>
        <td>${fmtPrice(b.total_price)}</td><td>${b.created_at}</td>
      </tr>`).join('');
  } catch (e) { console.error(e); }
}

// Рейсы
async function loadAdminFlights() {
  const flights = await api('/api/admin/flights');
  const tbody = document.querySelector('#adminFlightsTable tbody');
  tbody.innerHTML = flights.map(f => `
    <tr>
      <td>${f.id}</td><td>${f.flight_number}</td><td>${f.from} → ${f.to}</td>
      <td>${f.departure_time}</td><td>${f.arrival_time}</td><td>${f.duration}</td>
      <td>${f.airline}</td><td>€${f.base_price}</td>
      <td>${f.seats_eco+f.seats_mid+f.seats_biz}</td>
      <td>
        <button class="btn-edit" onclick="openFlightEditor(${f.id})">✏️</button>
        <button class="btn-delete" onclick="confirmDelete('рейс ${f.flight_number}',()=>deleteFlight(${f.id}))">🗑️</button>
      </td>
    </tr>`).join('');
}

async function openFlightEditor(id) {
  populateAirportSelects();
  document.getElementById('flightEditorTitle').textContent = id ? 'Редактировать рейс' : 'Добавить рейс';
  if (id) {
    const flights = await api('/api/admin/flights');
    const f = flights.find(fl => fl.id === id);
    if (!f) return;
    document.getElementById('feNum').value = f.flight_number;
    document.getElementById('feAirline').value = f.airline;
    document.getElementById('feFrom').value = f.from;
    document.getElementById('feTo').value = f.to;
    document.getElementById('feDep').value = f.departure_time;
    document.getElementById('feArr').value = f.arrival_time;
    document.getElementById('feDur').value = f.duration;
    document.getElementById('fePrice').value = f.base_price;
    document.getElementById('feSeatsEco').value = f.seats_eco;
    document.getElementById('feSeatsMid').value = f.seats_mid;
    document.getElementById('feSeatsBiz').value = f.seats_biz;
    document.getElementById('feStatus').value = f.status;
    editingFlightId = id;
  } else {
    ['feNum','feAirline','feDep','feArr','feDur','fePrice','feSeatsEco','feSeatsMid','feSeatsBiz'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('feStatus').value = 'active';
    editingFlightId = null;
  }
  document.getElementById('flightEditorModal').classList.add('show');
}

async function saveFlightEditor() {
  const data = {
    flight_number: document.getElementById('feNum').value,
    airline: document.getElementById('feAirline').value,
    from: document.getElementById('feFrom').value,
    to: document.getElementById('feTo').value,
    departure_time: document.getElementById('feDep').value,
    arrival_time: document.getElementById('feArr').value,
    duration: document.getElementById('feDur').value,
    base_price: parseFloat(document.getElementById('fePrice').value),
    seats_eco: parseInt(document.getElementById('feSeatsEco').value)||0,
    seats_mid: parseInt(document.getElementById('feSeatsMid').value)||0,
    seats_biz: parseInt(document.getElementById('feSeatsBiz').value)||0,
    status: document.getElementById('feStatus').value,
  };
  if (editingFlightId) data.id = editingFlightId;
  try {
    await api('/api/admin/flights', {
      method: editingFlightId ? 'PUT' : 'POST',
      body: JSON.stringify(data),
    });
    closeModal('flightEditorModal');
    loadAdminFlights();
    notify('Рейс сохранён', 'success');
  } catch (e) { notify(e.message, 'error'); }
}

async function deleteFlight(id) {
  try {
    const res = await fetch(`/api/admin/flights/${id}`, { method:'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка удаления');
    notify(data.message || 'Рейс удалён', 'success');
  } catch (e) {
    notify(e.message, 'error');
  }
  await loadAdminFlights();       // обновить таблицу рейсов
  await loadAdminStats();         // обновить статистику
  await loadAdminBookings();      // обновить таблицу бронирований (могла измениться)
}

// Аэропорты
async function loadAdminAirports() {
  try {
    const adminAirports = await api('/api/admin/airports');
    const tbody = document.querySelector('#adminAirportsTable tbody');
    tbody.innerHTML = adminAirports.map(a => `
      <tr>
        <td>${a.code}</td><td>${a.name}</td><td>${a.city}</td><td>${a.country}</td>
        <td>
          <button class="btn-edit" onclick="openAirportEditor('${a.code}')">✏️</button>
          <button class="btn-delete" onclick="confirmDelete('аэропорт ${a.code}',()=>deleteAirport('${a.code}'))">🗑️</button>
        </td>
      </tr>`).join('');
  } catch (e) {
    console.error('Ошибка загрузки аэропортов админки:', e);
  }
}

function openAirportEditor(code) {
  editingAirportCode = code;
  document.getElementById('airportEditorTitle').textContent = code ? 'Редактировать аэропорт' : 'Добавить аэропорт';
  if (code) {
    const a = airports.find(x => x.code === code);
    document.getElementById('aeCode').value = a.code;
    document.getElementById('aeName').value = a.name;
    document.getElementById('aeCity').value = a.city;
    document.getElementById('aeCountry').value = a.country;
    document.getElementById('aeCode').readOnly = true;
  } else {
    ['aeCode','aeName','aeCity','aeCountry'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('aeCode').readOnly = false;
  }
  document.getElementById('airportEditorModal').classList.add('show');
}

async function saveAirportEditor() {
  const data = {
    code: document.getElementById('aeCode').value.toUpperCase(),
    name: document.getElementById('aeName').value,
    city: document.getElementById('aeCity').value,
    country: document.getElementById('aeCountry').value,
  };
  try {
    await api('/api/admin/airports', { method:'POST', body: JSON.stringify(data) });
    closeModal('airportEditorModal');
    airports = await api('/api/airports'); // обновить глобальный список
    populateAirportSelects();
    loadAdminAirports();
    notify('Аэропорт сохранён', 'success');
  } catch (e) { notify(e.message, 'error'); }
}

async function deleteAirport(code) {
  try {
    const res = await fetch(`/api/admin/airports/${code}`, { method:'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка удаления');
    notify('Аэропорт удалён', 'success');
    // Обновляем глобальный список аэропортов и все select'ы
    airports = await api('/api/airports');
    populateAirportSelects();
  } catch (e) {
    notify(e.message, 'error');
  }
  await loadAdminAirports();      // обновить таблицу аэропортов
  await loadAdminFlights();       // мог быть удалён рейс, связанный с аэропортом
  await loadAdminStats();
}

// Пользователи
async function loadAdminUsers() {
  const users = await api('/api/admin/users');
  const tbody = document.querySelector('#adminUsersTable tbody');
  tbody.innerHTML = users.map(u => `
    <tr>
      <td>${u.name}</td><td>${u.email}</td>
      <td>${u.is_admin ? 'Админ' : 'Пользователь'}</td>
      <td>${u.bookings_count}</td><td>—</td>
      <td>${u.id !== currentUser.id ? `<button class="btn-delete" onclick="confirmDelete('пользователя ${u.name}',()=>deleteUser(${u.id}))">🗑️</button>` : 'Это вы'}</td>
    </tr>`).join('');
}

async function deleteUser(id) {
  try {
    await api(`/api/admin/users/${id}`, { method:'DELETE' });
    notify('Пользователь удалён', 'success');
  } catch (e) {
    notify(e.message, 'error');
  }
  await loadAdminUsers();
  await loadAdminStats();
  await loadAdminBookings();
}

// Бронирования
async function loadAdminBookings() {
  const bookings = await api('/api/admin/bookings');
  const tbody = document.querySelector('#adminBookingsTable tbody');
  tbody.innerHTML = bookings.map(b => `
    <tr>
      <td>${b.ref}</td><td>${b.passenger_name}</td><td>${b.flight_number}</td>
      <td>${b.route}</td><td>${classNames[b.class]}</td><td>${b.seat||'—'}</td>
      <td>${fmtPrice(b.total_price)}</td>
      <td><button class="btn-delete" onclick="confirmDelete('бронирование ${b.ref}',()=>deleteBooking(${b.id}))">🗑️</button></td>
    </tr>`).join('');
}

async function deleteBooking(id) {
  try {
    await api(`/api/admin/bookings/${id}`, { method:'DELETE' });
    notify('Бронирование отменено', 'success');
  } catch (e) {
    notify(e.message, 'error');
  }
  await loadAdminBookings();
  await loadAdminStats();
}

// Подтверждение удаления
function confirmDelete(what, cb) {
  document.getElementById('confirmMsg').textContent = `Вы уверены, что хотите удалить ${what}?`;
  confirmCallback = cb;
  document.getElementById('confirmOkBtn').onclick = () => { cb(); closeModal('confirmModal'); };
  document.getElementById('confirmModal').classList.add('show');
}

// ============================================================
// Утилиты
// ============================================================
function closeModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.remove('show');
}
function notify(msg, type='') {
  const n = document.getElementById('notif');
  document.getElementById('notifText').textContent = msg;
  n.className = 'notif' + (type ? ' '+type : '');
  n.classList.add('show');
  setTimeout(() => n.classList.remove('show'), 3200);
}
function formatCard(el) { el.value = el.value.replace(/\D/g,'').slice(0,16).replace(/(.{4})/g,'$1 ').trim(); }
function formatExpiry(el) { el.value = el.value.replace(/\D/g,'').slice(0,4).replace(/^(\d{2})(\d{1,2})/,'$1/$2'); }

// Закрытие модалок по клику на оверлей
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', function(e) {
    if (e.target === this) closeModal(this.id);
  });
});

// Глобальные ссылки для onclick в HTML
window.showPage = showPage;
window.scrollToSearch = scrollToSearch;
window.openAuthModal = openAuthModal;
window.switchAuthTab = switchAuthTab;
window.doLogin = doLogin;
window.doRegister = doRegister;
window.logout = logout;
window.showMyTickets = showMyTickets;
window.showProfile = showProfile;
window.saveProfile = saveProfile;
window.pickAvatarColor = pickAvatarColor;
window.showAdminPanel = showAdminPanel;
window.switchAdminTab = switchAdminTab;
window.searchFlights = searchFlights;
window.updateCurrency = updateCurrency;
window.setSearchTab = (type, btn) => {
  document.querySelectorAll('.search-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('retDateGroup').style.display = type === 'round' ? 'flex' : 'none';
};
window.editBooking = editBooking;
window.saveBookingEdits = saveBookingEdits;
window.cancelBooking = cancelBooking;
window.openBooking = openBooking;
window.selectClass = selectClass;
window.gotoBookingStep = gotoBookingStep;
window.selectSeat = selectSeat;
window.toggleService = toggleService;
window.confirmBooking = confirmBooking;
window.openFlightEditor = openFlightEditor;
window.saveFlightEditor = saveFlightEditor;
window.deleteFlight = deleteFlight;
window.openAirportEditor = openAirportEditor;
window.saveAirportEditor = saveAirportEditor;
window.deleteAirport = deleteAirport;
window.deleteUser = deleteUser;
window.deleteBooking = deleteBooking;
window.confirmDelete = confirmDelete;
window.saveRates = saveRates;
window.closeModal = closeModal;
window.formatCard = formatCard;
window.formatExpiry = formatExpiry;
window.toggleDropdown = toggleDropdown;

function navigateTo(target) {
  const burger = document.getElementById('burger-toggle');
  if (burger) burger.checked = false;
  closeMenu();
  const onHome = document.getElementById('pageHome')?.classList.contains('active');
  showPage('home', onHome ? { scrollTop: true } : {});

  setTimeout(() => {
    let targetY = 0;
    switch (target) {
      case 'home':
        targetY = 0;
        break;
      case 'search': {
        const searchBox = document.getElementById('searchBox');
        if (searchBox) targetY = searchBox.getBoundingClientRect().top + window.pageYOffset - 80;
        break;
      }
      case 'services': {
        const services = document.getElementById('services');
        if (services) targetY = services.getBoundingClientRect().top + window.pageYOffset - 60;
        break;
      }
      case 'about': {
        const about = document.getElementById('about');
        if (about) targetY = about.getBoundingClientRect().top + window.pageYOffset - 60;
        break;
      }
    }
    window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
  }, 80);
}

window.navigateTo = navigateTo;
window.updateEditTotal = updateEditTotal;
window.toggleEditService = toggleEditService;

// Анимация текста hero при скролле
(function() {
    const heroContent = document.querySelector('.hero-content');
    const heroSection = document.getElementById('heroSection');

    if (!heroContent || !heroSection) return;

    function animateHeroContent() {
        const scrollY = window.scrollY;
        const heroHeight = heroSection.offsetHeight;
        const fadeStart = heroHeight * 0.1;
        const fadeEnd = heroHeight * 0.4;

        let opacity = 1;
        let translateY = 0;

        if (scrollY > fadeStart) {
            const progress = Math.min(10, (scrollY - fadeStart) / (fadeEnd - fadeStart));
            opacity = 1 - progress;
            translateY = progress * 50;
        }

        heroContent.style.opacity = opacity;
        heroContent.style.transform = `translateY(-${translateY}px)`;
    }

    window.addEventListener('scroll', animateHeroContent, { passive: true });
    window.addEventListener('load', () => {
        // начальное появление (чтобы не было резкого скачка)
        heroContent.style.opacity = '1';
        heroContent.style.transform = 'translateY(0)';
        setTimeout(animateHeroContent, 200);
    });
})();

// ============================================================
// Единый контроллер плавной прокрутки (Parallax Done Right)
// ============================================================
(function() {
    let targetScroll = window.pageYOffset;
    let currentScroll = window.pageYOffset;
    let animFrame = null;
    let isAnimating = false;

    // Функция анимации (requestAnimationFrame)
    function animate() {
        const diff = targetScroll - currentScroll;
        
        // Если разница меньше 0.5px — завершаем
        if (Math.abs(diff) < 0.5) {
            window.scrollTo(0, targetScroll);
            currentScroll = targetScroll;
            isAnimating = false;
            animFrame = null;
            return;
        }

        // Плавное приближение (easeOut): 0.12 = коэффициент инерции
        // Меньше значение → более плавно, но медленнее
        // Больше значение → быстрее, но может дёргаться
        currentScroll += diff * 0.12;
        window.scrollTo(0, Math.round(currentScroll));
        
        animFrame = requestAnimationFrame(animate);
    }

    // Запуск анимации к новой цели
    function startAnimation(newTarget) {
        targetScroll = Math.max(0, Math.min(newTarget, 
            document.documentElement.scrollHeight - window.innerHeight));
        
        if (!isAnimating) {
            isAnimating = true;
            currentScroll = window.pageYOffset;
            animFrame = requestAnimationFrame(animate);
        }
    }

    // Перехват колеса мыши
    window.addEventListener('wheel', function(e) {
        // Не трогаем прокрутку внутри модалок, списков и полей
        if (e.target.closest('.modal-overlay, .dropdown-menu, textarea, select, .plane-body')) {
            return;
        }
        e.preventDefault();
        
        // Фиксированный шаг: 100px за одно движение колеса
        // Не зависит от интенсивности вращения или типа устройства
        const step = Math.sign(e.deltaY) * 100;
        startAnimation(targetScroll + step);
    }, { passive: false });

    // Публичный метод для программного скролла (поиск, навигация)
    window.smoothScrollToY = function(y) {
        startAnimation(y);
    };

    // Остановка анимации при ручном вмешательстве
    window.addEventListener('scroll', function() {
        if (isAnimating) {
            const realScroll = window.pageYOffset;
            // Если расхождение больше 3px — пользователь вмешался
            if (Math.abs(realScroll - currentScroll) > 3) {
                cancelAnimationFrame(animFrame);
                isAnimating = false;
                animFrame = null;
                targetScroll = realScroll;
                currentScroll = realScroll;
            }
        }
    }, { passive: true });
})();
