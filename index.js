const loginDialog = document.getElementById('loginDialog');
const loginButton = document.getElementById('loginButton');
const trackNameEl = document.getElementById('track-name');
const artistNameEl = document.getElementById('artist-name');
const albumArtEl = document.getElementById('album-art');
const rightSide = document.getElementById('right-side');
const mainContainer = document.querySelector('main');

const clientId = '36d6e644fd3e47f5ad7f2cde06336e8c';
const redirectUri = 'https://x3liinaa.github.io/spicy-lyrics-web/';
const scope = 'user-read-currently-playing';

let currentTrackId = "";
let currentLyrics = [];
let lastActiveIndex = -1;
let isPlaying = false;
let localProgressMs = 0;
let lastSyncTimestamp = 0;

async function checkLoginState() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const token = localStorage.getItem('access_token');

    if (code) {
        await exchangeCodeForToken(code);
    } else if (!token) {
        loginDialog.showModal();
    } else {
        loginDialog.close();
        startApp();
    }
}

async function exchangeCodeForToken(code) {
    const codeVerifier = localStorage.getItem('code_verifier');

    try {
        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: clientId,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: redirectUri,
                code_verifier: codeVerifier
            })
        });

        const data = await response.json();
        if (data.access_token) {
            localStorage.setItem('access_token', data.access_token);
            window.history.replaceState({}, document.title, "/");
            startApp();
        }
    } catch (err) {
        console.error("Auth error:", err);
    }
}

function startApp() {
    getNowPlaying();
    setInterval(getNowPlaying, 1000);
    requestAnimationFrame(animationLoop);
}

async function login() {
    const codeVerifier = generateRandomString(128);
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    localStorage.setItem('code_verifier', codeVerifier);

    const args = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        scope: scope,
        redirect_uri: redirectUri,
        code_challenge_method: 'S256',
        code_challenge: codeChallenge
    });

    window.location = 'https://accounts.spotify.com/authorize?' + args.toString();
}

function generateRandomString(length) {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length }, () => possible[Math.floor(Math.random() * possible.length)]).join('');
}

async function generateCodeChallenge(codeVerifier) {
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getNowPlaying() {
    const token = localStorage.getItem('access_token');
    if (!token) return;

    try {
        const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.status === 204) {
            isPlaying = false;
            return;
        } 
        
        if (response.status === 401) return logout();

        const data = await response.json();
        if (data?.item) {
            isPlaying = data.is_playing;
            if (isPlaying) {
                localProgressMs = data.progress_ms;
                lastSyncTimestamp = Date.now();
            }

            if (data.item.id !== currentTrackId) {
                currentTrackId = data.item.id;
                updateUI(data.item);
            }
        }
    } catch (e) {
        console.error("Sync error:", e);
    }
}

function updateUI(item) {
    const trackName = item.name;
    const artistName = item.artists[0].name;
    const albumImg = item.album.images[0].url;

    trackNameEl.textContent = trackName;
    artistNameEl.textContent = artistName;
    albumArtEl.src = albumImg;
    document.documentElement.style.setProperty('--bg-image', `url(${albumImg})`);

    checkMarquee();
    fetchLyrics(trackName, artistName, item.duration_ms);
}

async function fetchLyrics(track, artist, duration) {
    showLoader(rightSide);
    currentLyrics = [];
    lastActiveIndex = -1;

    try {
        const res = await fetch(`https://lrclib.net/api/get?track_name=${encodeURIComponent(track)}&artist_name=${encodeURIComponent(artist)}&duration=${Math.floor(duration / 1000)}`);
        const data = await res.json();
        if (data.syncedLyrics) {
            currentLyrics = parseLRC(data.syncedLyrics);
        }
    } catch (err) {
        console.error("Lyrics error:", err);
    }
    renderLyricsToDOM(currentLyrics);
}

function parseLRC(lrc) {
    const regex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;
    return lrc.split('\n').map(line => {
        const match = line.match(regex);
        if (!match) return null;
        return {
            time: (parseInt(match[1]) * 60000) + (parseInt(match[2]) * 1000) + parseInt(match[3].padEnd(3, '0')),
            text: match[4].trim(),
            isNote: match[4].trim() === "♪" || !match[4].trim()
        };
    }).filter(Boolean);
}

function renderLyricsToDOM(lyrics) {
    rightSide.innerHTML = '';
    mainContainer.classList.toggle('no-lyrics', !lyrics.length);
    if (!lyrics.length) return;

    const fragment = document.createDocumentFragment();
    lyrics.forEach(line => {
        const div = document.createElement('div');
        div.className = 'lyric-line';

        if (line.isNote) {
            div.appendChild(createNoteDots());
        } else {
            const words = line.text.split(' ');
            let charOffset = 0;
            words.forEach((word, i) => {
                const span = document.createElement('span');
                const wordWithSpace = word + (i < words.length - 1 ? ' ' : '');
                span.textContent = wordWithSpace;
                span.dataset.start = (charOffset / line.text.length) * 100;
                charOffset += wordWithSpace.length;
                span.dataset.end = (charOffset / line.text.length) * 100;
                div.appendChild(span);
            });
        }
        fragment.appendChild(div);
    });

    rightSide.appendChild(fragment);
    rightSide.offsetHeight; 
    rightSide.classList.add('animated-slide-in', 'from-right');
}

function updateActiveLyric(currentMs) {
    if (!currentLyrics.length) return;

    const activeIndex = currentLyrics.findLastIndex(l => currentMs >= l.time);
    const lyricElements = document.querySelectorAll('.lyric-line');

    if (activeIndex !== lastActiveIndex) {
        lyricElements.forEach((el, i) => {
            el.classList.toggle('passed', i < activeIndex);
            el.classList.toggle('active', i === activeIndex);
            if (i === activeIndex) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        lastActiveIndex = activeIndex;
    }

    if (activeIndex >= 0 && !currentLyrics[activeIndex].isNote) {
        const activeEl = lyricElements[activeIndex];
        const start = currentLyrics[activeIndex].time;
        const next = currentLyrics[activeIndex + 1]?.time || start + 5000;
        const progress = Math.min(100, Math.max(0, ((currentMs - start) / Math.min(next - start, currentLyrics[activeIndex].text.length * 150)) * 100));

        activeEl.querySelectorAll('span').forEach(span => {
            const s = parseFloat(span.dataset.start);
            const e = parseFloat(span.dataset.end);
            const localP = progress >= e ? 100 : (progress <= s ? -10 : ((progress - s) / (e - s)) * 100);
            span.style.setProperty('--local-progress', `${localP}%`);
            span.classList.toggle('current-word', progress > s && progress < e);
        });
    }
}

function animationLoop() {
    if (isPlaying && currentLyrics.length) {
        updateActiveLyric(localProgressMs + (Date.now() - lastSyncTimestamp));
    }
    requestAnimationFrame(animationLoop);
}

function checkMarquee() {
    const containerEl = document.querySelector('.track-info-container');
    if (trackNameEl.scrollWidth > containerEl.clientWidth) {
        const dist = trackNameEl.scrollWidth - containerEl.clientWidth + 20;
        trackNameEl.style.setProperty('--scroll-dist', `-${dist}px`);
        trackNameEl.style.setProperty('--scroll-dur', `${Math.max(14, dist / 10)}s`);
        trackNameEl.classList.add('scrolling');
    } else {
        trackNameEl.classList.remove('scrolling');
    }
}

function createNoteDots() {
    const div = document.createElement('div');
    div.className = 'note-dots';
    for (let i = 0; i < 3; i++) div.appendChild(document.createElement('div'));
    return div;
}

function showLoader(container) {
    container.classList.remove('animated-slide-in', 'from-right');
    container.innerHTML = '<div class="loaderContainer active"><div class="Loader1"></div></div>';
}

function logout() {
    localStorage.clear();
    window.location.reload();
}

loginButton.addEventListener("click", e => { e.preventDefault(); login(); });
checkLoginState();