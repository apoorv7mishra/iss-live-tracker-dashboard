import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import {
  Bot,
  CalendarDays,
  ChartPie,
  ExternalLink,
  Globe2,
  Loader2,
  MapPin,
  MessageCircle,
  Moon,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Sun,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  ArcElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip as ChartTooltip,
} from 'chart.js';
import { Doughnut, Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, ArcElement, ChartTooltip, Legend);

const ISS_API = 'http://api.open-notify.org';
const NEWS_CACHE_KEY = 'dashboard-news-cache-v1';
const CHAT_CACHE_KEY = 'dashboard-chat-v1';
const THEME_KEY = 'dashboard-theme-v1';
const NEWS_TTL = 15 * 60 * 1000;
const NEWS_CATEGORIES = ['science', 'technology'];
const HF_MODEL = 'mistralai/Mistral-7B-Instruct-v0.2';

const issIcon = L.divIcon({
  html: '<div class="iss-marker"><span>ISS</span></div>',
  className: '',
  iconSize: [58, 58],
  iconAnchor: [29, 29],
});

function getCachedJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function setCachedJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}

async function fetchOpenNotify(path) {
  const url = `${ISS_API}${path}`;
  try {
    return await fetchJson(url);
  } catch {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    return fetchJson(proxyUrl);
  }
}

function haversineKm(a, b) {
  const earthRadiusKm = 6371;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
}

function estimateOcean(lat, lng) {
  if (lat > 66) return 'Arctic Ocean region';
  if (lat < -55) return 'Southern Ocean region';
  if (lng > -100 && lng < 20 && lat > -60 && lat < 70) return 'Atlantic Ocean region';
  if (lng >= 20 && lng < 120 && lat > -60 && lat < 35) return 'Indian Ocean region';
  return 'Pacific Ocean region';
}

async function reverseGeocode(lat, lng) {
  try {
    const data = await fetchJson(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=6`,
      { headers: { Accept: 'application/json' } },
    );
    const address = data.address || {};
    return (
      address.city ||
      address.town ||
      address.state ||
      address.country ||
      data.display_name?.split(',').slice(0, 2).join(', ') ||
      estimateOcean(lat, lng)
    );
  } catch {
    return estimateOcean(lat, lng);
  }
}

async function fetchIssSnapshot() {
  try {
    const data = await fetchOpenNotify('/iss-now.json');
    return {
      lat: Number(data.iss_position.latitude),
      lng: Number(data.iss_position.longitude),
      timestamp: Number(data.timestamp) * 1000,
      source: 'Open Notify',
    };
  } catch {
    const data = await fetchJson('https://api.wheretheiss.at/v1/satellites/25544');
    return {
      lat: Number(data.latitude),
      lng: Number(data.longitude),
      timestamp: Number(data.timestamp) * 1000,
      source: 'Where the ISS at',
    };
  }
}

async function fetchAstronauts() {
  try {
    const data = await fetchOpenNotify('/astros.json');
    return {
      total: data.number || data.people?.length || 0,
      people: (data.people || []).map((person) => person.name),
      source: 'Open Notify',
    };
  } catch {
    return {
      total: 0,
      people: [],
      source: 'Unavailable',
    };
  }
}

function normalizeArticle(article, category, fallbackImage) {
  return {
    id: article.url || article.uri || `${category}-${article.title}`,
    title: article.title || 'Untitled article',
    source: article.source?.name || article.source?.title || article.source || 'Unknown source',
    author: article.author || article.authors?.[0]?.name || 'Unknown',
    date: article.publishedAt || article.dateTime || article.pubDate || article.created_at || new Date().toISOString(),
    image: article.urlToImage || article.image || article.imageUrl || fallbackImage,
    description: article.description || article.body || article.summary || article.content || 'No short description was provided.',
    url: article.url || article.link || article.uri || '#',
    category,
  };
}

async function fetchNewsApiCategory(category, apiKey) {
  const url = new URL('https://newsapi.org/v2/top-headlines');
  url.searchParams.set('category', category);
  url.searchParams.set('language', 'en');
  url.searchParams.set('pageSize', '5');
  url.searchParams.set('apiKey', apiKey);
  const data = await fetchJson(url.toString());
  return (data.articles || []).map((article) => normalizeArticle(article, category, `https://source.unsplash.com/900x600/?${category},news`));
}

async function fetchSpaceflightFallback() {
  const data = await fetchJson('https://api.spaceflightnewsapi.net/v4/articles/?limit=5');
  return (data.results || []).map((article) => normalizeArticle(article, 'science', 'https://source.unsplash.com/900x600/?space,station'));
}

async function fetchHackerNewsFallback() {
  const data = await fetchJson('https://hn.algolia.com/api/v1/search_by_date?tags=story&query=technology');
  return (data.hits || []).slice(0, 5).map((article) =>
    normalizeArticle(
      {
        title: article.title,
        source: 'Hacker News',
        author: article.author,
        publishedAt: article.created_at,
        description: article.story_text || article.title,
        url: article.url || `https://news.ycombinator.com/item?id=${article.objectID}`,
      },
      'technology',
      'https://source.unsplash.com/900x600/?technology,computer',
    ),
  );
}

async function fetchNewsCategory(category, force = false) {
  const cached = getCachedJson(NEWS_CACHE_KEY, {});
  if (!force && cached[category] && Date.now() - cached[category].savedAt < NEWS_TTL) {
    return cached[category].articles;
  }

  const apiKey = import.meta.env.VITE_NEWS_API_KEY;
  let articles;
  try {
    if (apiKey) {
      articles = await fetchNewsApiCategory(category, apiKey);
    }
  } catch {
    articles = null;
  }

  if (!articles?.length) {
    articles = category === 'science' ? await fetchSpaceflightFallback() : await fetchHackerNewsFallback();
  }

  const nextCache = getCachedJson(NEWS_CACHE_KEY, {});
  nextCache[category] = { savedAt: Date.now(), articles };
  setCachedJson(NEWS_CACHE_KEY, nextCache);
  return articles;
}

function MapUpdater({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.flyTo([position.lat, position.lng], Math.max(map.getZoom(), 3), { duration: 0.8 });
  }, [map, position]);
  return null;
}

function StatCard({ icon: Icon, label, value, detail }) {
  return (
    <section className="stat-card">
      <div className="stat-icon"><Icon size={20} /></div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        {detail && <span>{detail}</span>}
      </div>
    </section>
  );
}

function Toasts({ toasts }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => <div className={`toast ${toast.type}`} key={toast.id}>{toast.message}</div>)}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="article-card skeleton">
      <div className="skeleton-image" />
      <div className="skeleton-line long" />
      <div className="skeleton-line" />
      <div className="skeleton-line short" />
    </div>
  );
}

function Chatbot({ dashboardData, addToast }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [messages, setMessages] = useState(() =>
    getCachedJson(CHAT_CACHE_KEY, [
      { role: 'assistant', text: 'Ask me about the ISS position, speed, astronauts, or the news currently loaded on this dashboard.' },
    ]),
  );
  const bottomRef = useRef(null);

  useEffect(() => {
    setCachedJson(CHAT_CACHE_KEY, messages.slice(-30));
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  const answerLocally = (question) => {
    const q = question.toLowerCase();
    const iss = dashboardData.iss;
    if (q.includes('speed')) return `The ISS speed shown on the dashboard is ${Math.round(iss.speed || 0).toLocaleString()} km/h.`;
    if (q.includes('latitude') || q.includes('longitude') || q.includes('location') || q.includes('where')) {
      return `The ISS is at latitude ${iss.lat?.toFixed(4)} and longitude ${iss.lng?.toFixed(4)}, near ${iss.place}.`;
    }
    if (q.includes('astronaut') || q.includes('people') || q.includes('space')) {
      return `The dashboard currently shows ${dashboardData.astronauts.total} people in space: ${dashboardData.astronauts.people.join(', ') || 'names unavailable'}.`;
    }
    if (q.includes('article') || q.includes('news') || q.includes('summary')) {
      const titles = dashboardData.news.slice(0, 5).map((item, index) => `${index + 1}. ${item.title}`).join(' ');
      return `There are ${dashboardData.news.length} loaded articles. Top items: ${titles}`;
    }
    return 'I can only answer from the current dashboard data: ISS location, ISS speed, astronauts, and loaded news articles.';
  };

  const askHuggingFace = async (question) => {
    const token = import.meta.env.VITE_AI_TOKEN;
    if (!token) return answerLocally(question);
    const context = JSON.stringify(dashboardData, null, 2).slice(0, 7000);
    const prompt = `[INST] You are a dashboard chatbot. Answer ONLY using this JSON dashboard data. If the answer is not present, say you can only answer from dashboard data. Keep the answer concise.\n\nDASHBOARD DATA:\n${context}\n\nQUESTION: ${question} [/INST]`;
    const data = await fetchJson(`https://api-inference.huggingface.co/models/${HF_MODEL}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inputs: prompt, parameters: { max_new_tokens: 180, temperature: 0.2 } }),
    });
    const raw = Array.isArray(data) ? data[0]?.generated_text : data.generated_text;
    const answer = raw?.split('[/INST]').pop()?.trim();
    return answer || answerLocally(question);
  };

  const sendMessage = async (event) => {
    event?.preventDefault();
    const question = input.trim();
    if (!question || typing) return;
    setInput('');
    setTyping(true);
    setMessages((current) => [...current, { role: 'user', text: question }].slice(-30));
    try {
      const answer = await askHuggingFace(question);
      setMessages((current) => [...current, { role: 'assistant', text: answer }].slice(-30));
    } catch {
      setMessages((current) => [...current, { role: 'assistant', text: answerLocally(question) }].slice(-30));
      addToast('AI service unavailable, answered with local dashboard rules.', 'warning');
    } finally {
      setTyping(false);
    }
  };

  const clearChat = () => {
    const starter = [{ role: 'assistant', text: 'Chat cleared. I still only answer from the dashboard data.' }];
    setMessages(starter);
    setCachedJson(CHAT_CACHE_KEY, starter);
  };

  return (
    <>
      <button className="chat-fab" type="button" onClick={() => setOpen((value) => !value)} aria-label="Open chat">
        {open ? <X /> : <MessageCircle />}
      </button>
      {open && (
        <aside className="chat-panel">
          <header>
            <div>
              <Bot size={19} />
              <strong>Dashboard AI</strong>
            </div>
            <button type="button" onClick={clearChat} aria-label="Clear chat"><Trash2 size={17} /></button>
          </header>
          <div className="chat-messages">
            {messages.map((message, index) => (
              <p className={`chat-bubble ${message.role}`} key={`${message.role}-${index}`}>{message.text}</p>
            ))}
            {typing && <p className="chat-bubble assistant typing">Typing...</p>}
            <span ref={bottomRef} />
          </div>
          <form onSubmit={sendMessage}>
            <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask about dashboard data" />
            <button type="submit" aria-label="Send message"><Send size={18} /></button>
          </form>
        </aside>
      )}
    </>
  );
}

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || 'dark');
  const [issPositions, setIssPositions] = useState([]);
  const [place, setPlace] = useState('Locating...');
  const [astronauts, setAstronauts] = useState({ total: 0, people: [], source: 'Loading' });
  const [news, setNews] = useState([]);
  const [newsLoading, setNewsLoading] = useState({});
  const [errors, setErrors] = useState({});
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [toasts, setToasts] = useState([]);

  const addToast = (message, type = 'success') => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, message, type }]);
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3500);
  };

  const latestPosition = issPositions.at(-1);
  const previousPosition = issPositions.at(-2);
  const currentSpeed = useMemo(() => {
    if (!latestPosition || !previousPosition) return 0;
    const hours = Math.max((latestPosition.timestamp - previousPosition.timestamp) / 3600000, 1 / 3600);
    return haversineKm(previousPosition, latestPosition) / hours;
  }, [latestPosition, previousPosition]);

  const speedHistory = useMemo(() => {
    const rows = [];
    for (let i = 1; i < issPositions.length; i += 1) {
      const previous = issPositions[i - 1];
      const current = issPositions[i];
      const hours = Math.max((current.timestamp - previous.timestamp) / 3600000, 1 / 3600);
      rows.push({ time: new Date(current.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), speed: Math.round(haversineKm(previous, current) / hours) });
    }
    return rows.slice(-30);
  }, [issPositions]);

  const loadIss = async (manual = false) => {
    try {
      const snapshot = await fetchIssSnapshot();
      setIssPositions((current) => [...current, snapshot].slice(-30));
      reverseGeocode(snapshot.lat, snapshot.lng).then(setPlace);
      if (manual) addToast('ISS location refreshed.');
    } catch (error) {
      setErrors((current) => ({ ...current, iss: error.message }));
      if (manual) addToast('Unable to refresh ISS location.', 'error');
    }
  };

  const loadAstronauts = async () => {
    const data = await fetchAstronauts();
    setAstronauts(data);
  };

  const loadNews = async (category, force = false) => {
    setNewsLoading((current) => ({ ...current, [category]: true }));
    setErrors((current) => ({ ...current, [category]: '' }));
    try {
      const articles = await fetchNewsCategory(category, force);
      setNews((current) => {
        const withoutCategory = current.filter((article) => article.category !== category);
        return [...withoutCategory, ...articles].slice(0, 10);
      });
      if (force) addToast(`${category} news refreshed.`);
    } catch (error) {
      setErrors((current) => ({ ...current, [category]: error.message }));
      addToast(`Unable to load ${category} news.`, 'error');
    } finally {
      setNewsLoading((current) => ({ ...current, [category]: false }));
    }
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    loadIss();
    loadAstronauts();
    NEWS_CATEGORIES.forEach((category) => loadNews(category));
    const issTimer = setInterval(loadIss, 15000);
    const astroTimer = setInterval(loadAstronauts, 60000);
    return () => {
      clearInterval(issTimer);
      clearInterval(astroTimer);
    };
  }, []);

  const filteredNews = useMemo(() => {
    return news
      .filter((article) => categoryFilter === 'all' || article.category === categoryFilter)
      .filter((article) => `${article.title} ${article.source} ${article.description}`.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => sortBy === 'source'
        ? a.source.localeCompare(b.source)
        : new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [news, query, sortBy, categoryFilter]);

  const newsDistribution = NEWS_CATEGORIES.map((category) => news.filter((article) => article.category === category).length);

  const chartTextColor = theme === 'dark' ? '#d7deea' : '#263241';
  const speedChartData = {
    labels: speedHistory.map((point) => point.time),
    datasets: [{
      label: 'ISS speed km/h',
      data: speedHistory.map((point) => point.speed),
      borderColor: '#2dd4bf',
      backgroundColor: 'rgba(45, 212, 191, 0.16)',
      fill: true,
      tension: 0.35,
    }],
  };

  const distributionData = {
    labels: NEWS_CATEGORIES,
    datasets: [{
      data: newsDistribution,
      backgroundColor: ['#2dd4bf', '#f97316'],
      borderWidth: 0,
    }],
  };

  const dashboardData = {
    iss: {
      lat: latestPosition?.lat,
      lng: latestPosition?.lng,
      speed: currentSpeed,
      place,
      trackedPositions: issPositions.length,
      updatedAt: latestPosition ? new Date(latestPosition.timestamp).toISOString() : null,
    },
    astronauts,
    news: filteredNews.map(({ title, source, author, date, description, category }) => ({ title, source, author, date, description, category })),
  };

  return (
    <main className="app-shell">
      <Toasts toasts={toasts} />
      <header className="topbar">
        <div>
          <span className="eyebrow"><Sparkles size={15} /> Live Space Intelligence</span>
          <h1>ISS News AI Dashboard</h1>
        </div>
        <button className="theme-toggle" type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
      </header>

      <section className="stats-grid">
        <StatCard icon={MapPin} label="Latitude / Longitude" value={latestPosition ? `${latestPosition.lat.toFixed(3)}, ${latestPosition.lng.toFixed(3)}` : 'Loading'} detail={latestPosition?.source} />
        <StatCard icon={Globe2} label="ISS Speed" value={`${Math.round(currentSpeed).toLocaleString()} km/h`} detail="Haversine estimate" />
        <StatCard icon={CalendarDays} label="Current Location" value={place} detail={`${issPositions.length} positions tracked`} />
        <StatCard icon={Users} label="People in Space" value={astronauts.total || 'Loading'} detail={astronauts.people.slice(0, 3).join(', ') || astronauts.source} />
      </section>

      <section className="dashboard-grid">
        <div className="panel map-panel">
          <div className="panel-header">
            <div>
              <h2>ISS Live Map</h2>
              <p>Updates every 15 seconds with the last 15 positions.</p>
            </div>
            <button type="button" onClick={() => loadIss(true)}><RefreshCw size={17} /> Refresh</button>
          </div>
          {errors.iss && <div className="error-box">{errors.iss}<button type="button" onClick={() => loadIss(true)}>Retry</button></div>}
          <MapContainer center={[latestPosition?.lat || 0, latestPosition?.lng || 0]} zoom={3} minZoom={2} worldCopyJump className="iss-map">
            <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {latestPosition && (
              <>
                <MapUpdater position={latestPosition} />
                <Marker position={[latestPosition.lat, latestPosition.lng]} icon={issIcon}>
                  <Tooltip direction="top" offset={[0, -18]} permanent={false}>
                    ISS: {latestPosition.lat.toFixed(2)}, {latestPosition.lng.toFixed(2)}<br />
                    {Math.round(currentSpeed).toLocaleString()} km/h
                  </Tooltip>
                </Marker>
                <Polyline positions={issPositions.slice(-15).map((position) => [position.lat, position.lng])} pathOptions={{ color: '#2dd4bf', weight: 4 }} />
              </>
            )}
          </MapContainer>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Speed Trend</h2>
              <p>Last 30 speed measurements.</p>
            </div>
          </div>
          <Line
            data={speedChartData}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { labels: { color: chartTextColor } } },
              scales: {
                x: { ticks: { color: chartTextColor }, grid: { color: 'rgba(127,127,127,0.14)' } },
                y: { ticks: { color: chartTextColor }, grid: { color: 'rgba(127,127,127,0.14)' } },
              },
            }}
          />
        </div>

        <div className="panel astronauts-panel">
          <div className="panel-header">
            <div>
              <h2>Astronauts</h2>
              <p>People currently in space.</p>
            </div>
            <button type="button" onClick={loadAstronauts}><RefreshCw size={17} /> Refresh</button>
          </div>
          <ul className="people-list">
            {astronauts.people.length ? astronauts.people.map((name) => <li key={name}>{name}</li>) : <li>Names unavailable from API.</li>}
          </ul>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>News Mix</h2>
              <p>Click a slice to filter articles.</p>
            </div>
            <ChartPie size={22} />
          </div>
          <div className="donut-wrap">
            <Doughnut
              data={distributionData}
              options={{
                plugins: { legend: { labels: { color: chartTextColor } } },
                onClick: (_event, elements) => {
                  if (elements[0]) setCategoryFilter(NEWS_CATEGORIES[elements[0].index]);
                },
              }}
            />
          </div>
        </div>
      </section>

      <section className="news-section">
        <div className="news-toolbar">
          <div>
            <h2>Latest Articles</h2>
            <p>Five science and five technology articles, cached for 15 minutes.</p>
          </div>
          <div className="toolbar-controls">
            <label className="search-field">
              <Search size={17} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search articles" />
            </label>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
              <option value="date">Sort by date</option>
              <option value="source">Sort by source</option>
            </select>
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="all">All categories</option>
              {NEWS_CATEGORIES.map((category) => <option value={category} key={category}>{category}</option>)}
            </select>
          </div>
        </div>
        <div className="category-actions">
          {NEWS_CATEGORIES.map((category) => (
            <button type="button" key={category} onClick={() => loadNews(category, true)} disabled={newsLoading[category]}>
              {newsLoading[category] ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />}
              Refresh {category}
            </button>
          ))}
        </div>
        {NEWS_CATEGORIES.map((category) => errors[category] && (
          <div className="error-box" key={category}>{category}: {errors[category]}<button type="button" onClick={() => loadNews(category, true)}>Retry</button></div>
        ))}
        <div className="articles-grid">
          {news.length === 0 && (newsLoading.science || newsLoading.technology)
            ? Array.from({ length: 6 }, (_, index) => <SkeletonCard key={index} />)
            : filteredNews.map((article) => (
              <article className="article-card" key={article.id}>
                <img src={article.image} alt="" loading="lazy" onError={(event) => { event.currentTarget.src = `https://source.unsplash.com/900x600/?${article.category},news`; }} />
                <div className="article-body">
                  <div className="article-meta"><span>{article.category}</span><span>{article.source}</span></div>
                  <h3>{article.title}</h3>
                  <p>{article.description}</p>
                  <div className="article-footer">
                    <span>{article.author} · {new Date(article.date).toLocaleDateString()}</span>
                    <a href={article.url} target="_blank" rel="noreferrer">Read More <ExternalLink size={15} /></a>
                  </div>
                </div>
              </article>
            ))}
        </div>
      </section>

      <Chatbot dashboardData={dashboardData} addToast={addToast} />
    </main>
  );
}
