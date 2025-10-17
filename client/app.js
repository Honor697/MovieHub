// client/app.js
const API_BASE = ''; // same origin (server serves client). If server at different origin, set 'http://localhost:5000'
const imageBase = 'https://image.tmdb.org/t/p'; // TMDb image base (sizes used below)

// utilities
const $ = sel => document.querySelector(sel);
const create = (tag, cls='') => Object.assign(document.createElement(tag), { className: cls });

// Auth helpers
function saveToken(t){ localStorage.setItem('token', t); }
function getToken(){ return localStorage.getItem('token'); }
function removeToken(){ localStorage.removeItem('token'); }
async function apiFetch(path, opts = {}) {
  const headers = opts.headers || {};
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(API_BASE + path, { ...opts, headers });
  if (res.status === 401) {
    // invalid token — remove
    removeToken();
  }
  return res;
}

// build UI sections
const bannerEl = $('#banner');
const rowsEl = $('#rows');
const modal = $('#modal');
const modalBody = $('#modalBody');
const routeRoot = $('#route-root');

// initial: bind nav actions
$('#navAccount').addEventListener('click', ()=> location.hash = '#account');
$('#btnSearch').addEventListener('click', () => {
  const q = $('#searchInput').value.trim();
  if (q) searchMovies(q);
});

// Hash routing: #/, #login, #signup, #movies, #account
function router() {
  const h = location.hash.replace('#','') || '';
  routeRoot.innerHTML = '';
  if (!h || h === 'movies' || h === '') {
    // main movies UI shown by default (banner + rows)
    bannerEl.style.display = '';
    rowsEl.style.display = '';
  } else {
    // hide main UI while alt pages shown
    bannerEl.style.display = 'none';
    rowsEl.style.display = 'none';
  }

  if (h === 'login') renderLogin();
  else if (h === 'signup') renderSignup();
  else if (h === 'account') renderAccount();
  else {
    // default: ensure we have movies
    fetchAndRenderHome();
  }
}
window.addEventListener('hashchange', router);

// --- AUTH pages ---
function renderLogin(){
  routeRoot.innerHTML = `
    <div class="auth-card">
      <h2>Login</h2>
      <input id="loginEmail" placeholder="Email" />
      <input id="loginPass" placeholder="Password" type="password" />
      <button id="doLogin" class="btn btn-play">Login</button>
      <p>Don't have an account? <a href="#signup">Sign up</a></p>
      <div id="authMsg"></div>
    </div>`;
  $('#doLogin').addEventListener('click', async ()=>{
    const email = $('#loginEmail').value.trim();
    const password = $('#loginPass').value;
    const res = await apiFetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) { $('#authMsg').innerText = data.error || 'Login failed'; return; }
    saveToken(data.token);
    location.hash = '#movies';
    await fetchAndRenderHome();
  });
}

function renderSignup(){
  routeRoot.innerHTML = `
    <div class="auth-card">
      <h2>Sign up</h2>
      <input id="signupName" placeholder="Name (optional)" />
      <input id="signupEmail" placeholder="Email" />
      <input id="signupPass" placeholder="Password" type="password" />
      <button id="doSignup" class="btn btn-play">Create account</button>
      <p>Already have an account? <a href="#login">Login</a></p>
      <div id="authMsg"></div>
    </div>`;
  $('#doSignup').addEventListener('click', async ()=>{
    const name = $('#signupName').value.trim();
    const email = $('#signupEmail').value.trim();
    const password = $('#signupPass').value;
    const res = await apiFetch('/auth/signup', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ name, email, password })
    });
    const data = await res.json();
    if (!res.ok) { $('#authMsg').innerText = data.error || 'Signup failed'; return; }
    saveToken(data.token);
    location.hash = '#movies';
    await fetchAndRenderHome();
  });
}

async function renderAccount(){
  const res = await apiFetch('/auth/me');
  const data = await res.json();
  if (!res.ok) {
    // not logged in
    routeRoot.innerHTML = `<div class="auth-card"><p>Please <a href="#login">login</a> to access account.</p></div>`;
    return;
  }
  routeRoot.innerHTML = `
    <div class="account-card">
      <h2>Account</h2>
      <p><strong>Name:</strong> ${data.name || '(not set)'}</p>
      <p><strong>Email:</strong> ${data.email}</p>
      <h3>Your Watchlist</h3>
      <div id="watchlistGrid" class="row-scroller"></div>
      <button id="doLogout" class="btn btn-list">Logout</button>
    </div>; `
  $('#doLogout').addEventListener('click', ()=> {
    removeToken();
    location.hash = '#movies';
    fetchAndRenderHome();
  });
  // show watchlist
  const wRes = await apiFetch('/api/watchlist');
  if (wRes.ok) {
    const j = await wRes.json();
    const grid = $('#watchlistGrid');
    grid.innerHTML = '';
    (j.watchlist || []).forEach(m => {
      const p = create('div','poster');
      p.innerHTML = `<img src="${m.poster_path ? imageBase + '/w342' + m.poster_path : 'assets/placeholder.jpg'}" alt="${m.title||m.name}" />`;
      p.addEventListener('click', ()=> openModal(m.id));
      grid.appendChild(p);
    });
  }
}

// --- Home / Movies UI ---
let tmdbConfig = { images: { secure_base_url: 'https://image.tmdb.org/t/p/', poster_sizes: ['w342','w500','original'] } };

async function fetchConfig(){
  try {
    const res = await apiFetch('/api/configuration');
    if (res.ok) {
      const d = await res.json();
      tmdbConfig = d;
    }
  } catch(e){}
}

async function fetchAndRenderHome(){
  // load config & trending/popular/top_rated
  await fetchConfig();
  bannerEl.innerHTML = '<div style="padding:24px">Loading...</div>';
  rowsEl.innerHTML = '';
  try{
    const trending = await (await apiFetch('/api/trending/all/day')).json();
    const popular = await (await apiFetch('/api/trending/movie/week')).json();
    const top = await (await apiFetch('/api/trending/tv/week')).json();

    const hero = trending.results && trending.results[0];
    renderBanner(hero);
    renderRow('Trending Now', trending.results || []);
    renderRow('Popular Movies', popular.results || []);
    renderRow('Top TV', top.results || []);
  }catch(e){
    bannerEl.innerHTML = '<div style="padding:24px">Failed to load movies.</div>';
  }
}

function renderBanner(movie){
  if(!movie){ bannerEl.style.display='none'; return; }
  const title = movie.title || movie.name || '';
  const backdrop = movie.backdrop_path ? tmdbConfig.images.secure_base_url + 'original' + movie.backdrop_path : 'assets/placeholder.jpg';
  bannerEl.style.backgroundImage = `linear-gradient(to top, rgba(11,11,11,1), rgba(11,11,11,0.1)), url(${backdrop})`;
  bannerEl.innerHTML = `<div class="info">
    <h1>${title}</h1>
    <p>${(movie.overview||'').slice(0,220)}</p>
    <div style="margin-top:12px">
      <button class="btn btn-play" id="bannerPlay">Play</button>
      <button class="btn btn-list" id="bannerList">My List</button>
    </div>
  </div>`;
  $('#bannerPlay').addEventListener('click', ()=> openModal(movie.id));
  $('#bannerList').addEventListener('click', ()=> toggleWatchlist(movie));
}

function renderRow(title, movies){
  const section = create('section','row');
  const h = create('h3'); h.innerText = title;
  const scroller = create('div','row-scroller');
  movies.forEach(m => {
    const p = create('div','poster');
    const poster = m.poster_path || m.backdrop_path;
    p.innerHTML = `<img src="${poster ? tmdbConfig.images.secure_base_url + 'w342' + poster : 'assets/placeholder.jpg'}" alt="${m.title||m.name}">`;
    p.addEventListener('click', ()=> openModal(m.id));
    scroller.appendChild(p);
  });
  section.appendChild(h);
  section.appendChild(scroller);
  rowsEl.appendChild(section);
}

// modal details
async function openModal(movieId){
  modal.classList.remove('hidden');
  modalBody.innerHTML = '<div>Loading...</div>';
  const res = await apiFetch('/api/movie/' + movieId);
  if (!res.ok) { modalBody.innerText = 'Failed to load movie'; return; }
  const m = await res.json();
  const poster = m.poster_path ? tmdbConfig.images.secure_base_url + 'w500' + m.poster_path : '/assets/placeholder.jpg';
  const title = m.title || m.name;
  const trailer = (m.videos && m.videos.results && m.videos.results.find(v=>v.type==='Trailer')) || null;
  modalBody.innerHTML = `
    <div style="display:flex;gap:16px;flex-wrap:wrap">
      <img src="${poster}" style="width:220px;border-radius:6px" />
      <div>
        <h2>${title}</h2>
        <p style="color:#9aa4b2">${m.tagline||''}</p>
        <p style="max-width:600px">${m.overview||''}</p>
        <div style="margin-top:12px">
          <button class="btn btn-play" id="modalPlay">Play</button>
          <button class="btn btn-list" id="modalWatchlist">Toggle Watchlist</button>
        </div>
        ${trailer ? `<div style="margin-top:12px"><a href="https://www.youtube.com/watch?v=${trailer.key}" target="_blank">Watch Trailer</a></div>` : ''}
      </div>
    </div>
  `;
  $('#modalClose').onclick = () => modal.classList.add('hidden');
  $('#modalPlay').onclick = ()=> alert('Simulated playback — implement player embed as needed.');
  $('#modalWatchlist').onclick = ()=> toggleWatchlist(m);
}

async function toggleWatchlist(movie){
  // try toggling via server; if no token, prompt login
  const token = getToken();
  if (!token) { alert('Please login to save to your watchlist'); location.hash = '#login'; return; }
  const res = await apiFetch('/api/watchlist', {
    method:'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ movie: { id: movie.id, title: movie.title||movie.name, poster_path: movie.poster_path } })
  });
  if (res.ok) {
    const j = await res.json();
    alert('Watchlist updated (' + (j.watchlist.length) + ' items)');
  } else {
    const j = await res.json();
    alert('Failed: ' + (j.error||''));
  }
}

// search
async function searchMovies(q){
  bannerEl.style.display = 'none';
  rowsEl.innerHTML = '<div style="padding:14px">Searching...</div>';
  try {
    const res = await apiFetch('/api/search/movie?query=' + encodeURIComponent(q));
    const j = await res.json();
    rowsEl.innerHTML = '';
    renderRow(`Search results for "${q}"`, j.results || []);
  } catch(e){
    rowsEl.innerHTML = '<div style="padding:14px">Search failed.</div>';
  }
}

// modal close area
$('#modal').addEventListener('click', (e)=> {
  if (e.target === modal) modal.classList.add('hidden');
});

(async function init(){
  // initial CSS tweaks for auth forms
  const style = document.createElement('style'); style.innerHTML = `
  .auth-card, .account-card{background:#071019;padding:18px;border-radius:8px;max-width:420px;margin:24px auto}
  .auth-card input{display:block;width:100%;padding:10px;margin:8px 0;border-radius:6px;border:0;background:#0b0b0b;color:#fff}
  `;
  document.head.appendChild(style);

  // close modal button bound
  $('#modalClose').onclick = ()=> modal.classList.add('hidden');

  // initial routing
  if (!location.hash) location.hash = '#movies';
  router();
})();
