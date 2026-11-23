
import React, { useEffect, useState } from 'react';
import {
  Search, Sparkles, Compass, Bookmark, Star, X, ChevronRight,
  Play, LogIn, LogOut, User, Flame
} from 'lucide-react';
import { supabase } from './supabase';

const API = 'https://graphql.anilist.co';

const mediaFields = `
  id title { romaji english }
  coverImage { extraLarge large }
  bannerImage description(asHtml:false)
  averageScore episodes season seasonYear genres format status duration
  studios(isMain:true) { nodes { name } }
  relations {
    edges {
      relationType(version:2)
      node {
        id
        title { romaji english }
        format
        seasonYear
        episodes
        status
      }
    }
  }
`;

const POPULAR = `query {
  Page(page:1, perPage:18) {
    media(type:ANIME, sort:POPULARITY_DESC, isAdult:false) {
      ${mediaFields}
    }
  }
}`;

const TRENDING = `query {
  Page(page:1, perPage:12) {
    media(type:ANIME, sort:TRENDING_DESC, isAdult:false) {
      ${mediaFields}
    }
  }
}`;

async function gql(query, variables = {}) {
  const response = await fetch(API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ query, variables })
  });

  if (!response.ok) {
    throw new Error('Anime catalogue is temporarily unavailable.');
  }

  const json = await response.json();

  if (json.errors?.length) {
    throw new Error(json.errors[0].message);
  }

  return json.data;
}

const titleOf = a =>
  a?.title?.english || a?.title?.romaji || 'Untitled anime';

const clean = html =>
  (html || 'No synopsis is available yet.')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function App() {
  const [anime, setAnime] = useState([]);
  const [trending, setTrending] = useState([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);

  const [user, setUser] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState('signin');
  const [authMessage, setAuthMessage] = useState('');
  const [recoveryMode, setRecoveryMode] = useState(false);

  const [watchlist, setWatchlist] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [reviewText, setReviewText] = useState('');
  const [reviewScore, setReviewScore] = useState('8');

  useEffect(() => {
    Promise.all([gql(POPULAR), gql(TRENDING)])
      .then(([p, t]) => {
        setAnime(p.Page.media);
        setTrending(t.Page.media);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user || null);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user || null);

      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryMode(true);
        setAuthOpen(true);
        setAuthMessage('Enter your new password below.');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
  if (!supabase) return;

  loadPublicReviews();

  if (user) {
    loadUserData();
  } else {
    setWatchlist([]);
  }
}, [user]);

async function loadPublicReviews() {
  const { data, error } = await supabase
    .from('reviews')
    .select('id, anime_id, anime_title, score, body, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Reviews loading error:', error.message);
    return;
  }

  setReviews(data || []);
}

  async function loadUserData() {
    const [{ data: saved }, { data: written }] = await Promise.all([
      supabase.from('watchlist')
        .select('anime_id, anime_title, cover_image, status'),

      supabase.from('reviews')
        .select('id, anime_id, anime_title, score, body, created_at')
        .order('created_at', { ascending: false })
    ]);

    setWatchlist(saved || []);
    setReviews(written || []);
  }

  async function doSearch(e) {
    e?.preventDefault();

    const term = query.trim();

    if (!term) {
      setResults([]);
      return;
    }

    setSearching(true);
    setError('');

    try {
      const data = await gql(`
        query ($search:String!) {
          Page(page:1,perPage:24) {
            media(
              search:$search,
              type:ANIME,
              isAdult:false,
              sort:SEARCH_MATCH
            ) {
              ${mediaFields}
            }
          }
        }
      `, { search: term });

      setResults(data.Page.media);
    } catch (e) {
      setError(e.message);
    } finally {
      setSearching(false);
    }
  }

  async function authenticate(e) {
    e.preventDefault();
    setAuthMessage('');

    if (!supabase) {
      setAuthMessage('Supabase connection is not configured.');
      return;
    }

    const action = authMode === 'signin'
      ? supabase.auth.signInWithPassword({
          email: email.trim(),
          password
        })
      : supabase.auth.signUp({
          email: email.trim(),
          password
        });

    const { error } = await action;

    setAuthMessage(
      error
        ? error.message
        : authMode === 'signin'
          ? 'Signed in successfully.'
          : 'Check your email to confirm your account.'
    );
  }

  async function requestPasswordReset(e) {
    e.preventDefault();
    setAuthMessage('');

    if (!supabase) {
      setAuthMessage('Supabase connection is not configured.');
      return;
    }

    if (!email.trim()) {
      setAuthMessage('Please enter your registered email.');
      return;
    }

    const { error } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      {
        redirectTo: `${window.location.origin}/`
      }
    );

    setAuthMessage(
      error
        ? error.message
        : 'Password reset email sent. Check your inbox and spam folder.'
    );
  }

  async function updatePassword(e) {
    e.preventDefault();
    setAuthMessage('');

    if (password.length < 6) {
      setAuthMessage('Password must be at least 6 characters.');
      return;
    }

    const { error } = await supabase.auth.updateUser({
      password
    });

    if (error) {
      setAuthMessage(error.message);
      return;
    }

    setRecoveryMode(false);
    setAuthMode('signin');
    setPassword('');
    setAuthMessage('Password updated successfully. You are now signed in.');
  }

  async function signOut() {
    await supabase?.auth.signOut();
    setAuthOpen(false);
    setRecoveryMode(false);
  }

  async function toggleWatch(a) {
    if (!user || !supabase) {
      setAuthOpen(true);
      setAuthMessage('Sign in to save anime to your watchlist.');
      return;
    }

    const exists = watchlist.some(w => w.anime_id === a.id);

    if (exists) {
      const { error } = await supabase
        .from('watchlist')
        .delete()
        .eq('anime_id', a.id);

      if (!error) {
        setWatchlist(watchlist.filter(w => w.anime_id !== a.id));
      } else {
        setError(error.message);
      }
    } else {
      const item = {
        user_id: user.id,
        anime_id: a.id,
        anime_title: titleOf(a),
        cover_image: a.coverImage?.large || '',
        status: 'PLANNING'
      };

      const { error } = await supabase
        .from('watchlist')
        .insert(item);

      if (!error) {
        setWatchlist([...watchlist, item]);
      } else {
        setError(error.message);
      }
    }
  }

  async function submitReview(e) {
    e.preventDefault();

    if (!user || !supabase) {
      setAuthOpen(true);
      return;
    }

    if (!reviewText.trim()) return;

    const item = {
      user_id: user.id,
      anime_id: selected.id,
      anime_title: titleOf(selected),
      score: Number(reviewScore),
      body: reviewText.trim()
    };

    const { data, error } = await supabase
      .from('reviews')
      .insert(item)
      .select()
      .single();

    if (error) {
      setError(error.message);
    } else {
      setReviews([data, ...reviews]);
      setReviewText('');
    }
  }

  const displayed = query.trim() ? results : anime;
  const isSaved = a => watchlist.some(w => w.anime_id === a.id);

  return (
    <div className="app-shell">
      <div className="ambient ambient-one"></div>
      <div className="ambient ambient-two"></div>

      <header className="topbar">
        <a className="brand" href="#" onClick={() => {
          setQuery('');
          setResults([]);
        }}>
          <span className="brand-mark">星</span>
          <span>HOSHI<span className="brand-light">NAMI</span></span>
        </a>

        <nav>
          <a href="#discover"><Compass size={16}/> Discover</a>
          <a href="#trending"><Flame size={16}/> Trending</a>
          <a href="#watchlist"><Bookmark size={16}/> My list</a>
        </nav>

        <div className="header-actions">
          <button className="profile-btn" onClick={() => setAuthOpen(true)}>
            {user
              ? <><User size={16}/><span>Account</span></>
              : <><LogIn size={16}/><span>Sign in</span></>
            }
          </button>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">
              <Sparkles size={14}/> YOUR NEXT STORY STARTS HERE
            </div>

            <h1>Find your next<br/><span>anime obsession.</span></h1>

            <p>
              Explore worlds, meet unforgettable characters,
              and keep every story you love in one place.
            </p>

            <form className="searchbar" onSubmit={doSearch}>
              <Search size={19}/>
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search anime titles..."
                aria-label="Search anime"
              />
              <button type="submit" disabled={searching}>
                {searching ? 'Searching…' : 'Search'}
              </button>
            </form>

            <div className="hero-meta">
              <span><span className="pulse"></span> LIVE ANIME CATALOGUE</span>
              <span>DISCOVER • SAVE • REVIEW</span>
            </div>
          </div>

          <div className="hero-art">
            <div className="hero-orbit orbit-a"></div>
            <div className="hero-orbit orbit-b"></div>
            <div className="hero-glow"></div>
            <div className="hero-poster">
              <img
                src="https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b21-9Wthus.jpg"
                onError={e => e.currentTarget.style.display = 'none'}
                alt="Anime artwork"
              />
            </div>
            <div className="floating-tag tag-top">
              <Sparkles size={14}/> STORIES AWAIT
            </div>
            <div className="floating-tag tag-bottom">
              <span className="mini-dot"></span> EXPLORE THE UNKNOWN
            </div>
          </div>
        </section>

        {error && (
          <div className="notice">
            <span>{error}</span>
            <button onClick={() => setError('')}><X size={16}/></button>
          </div>
        )}

        {query.trim() && (
          <section className="section" id="discover">
            <div className="section-heading">
              <div>
                <div className="eyebrow">SEARCH RESULTS</div>
                <h2>Found for “{query}”</h2>
              </div>
              <button className="text-btn" onClick={() => {
                setQuery('');
                setResults([]);
              }}>
                Clear search <X size={14}/>
              </button>
            </div>

            {searching
              ? <div className="loading">Searching the anime universe…</div>
              : <AnimeGrid
                  items={results}
                  onSelect={setSelected}
                  onSave={toggleWatch}
                  isSaved={isSaved}
                />
            }

            {!searching && results.length === 0 && (
              <div className="empty">No results yet. Try another title.</div>
            )}
          </section>
        )}

        {!query.trim() && (
          <>
            <section className="section" id="trending">
              <div className="section-heading">
                <div>
                  <div className="eyebrow"><Flame size={13}/> WHAT'S HOT</div>
                  <h2>Trending now<span className="heading-period">.</span></h2>
                </div>
                <span className="section-note">POPULAR WITH THE COMMUNITY</span>
              </div>

              {loading
                ? <div className="loading">Loading trending anime…</div>
                : <AnimeGrid
                    items={trending}
                    onSelect={setSelected}
                    onSave={toggleWatch}
                    isSaved={isSaved}
                  />
              }
            </section>

            <section className="section" id="discover">
              <div className="section-heading">
                <div>
                  <div className="eyebrow"><Compass size={13}/> THE COLLECTION</div>
                  <h2>Popular anime<span className="heading-period">.</span></h2>
                </div>
                <span className="section-note">A WORLD OF STORIES TO EXPLORE</span>
              </div>

              {loading
                ? <div className="loading">Loading anime collection…</div>
                : <AnimeGrid
                    items={anime}
                    onSelect={setSelected}
                    onSave={toggleWatch}
                    isSaved={isSaved}
                  />
              }
            </section>

            <section className="section personal-section" id="watchlist">
              <div className="section-heading">
                <div>
                  <div className="eyebrow"><Bookmark size={13}/> YOUR SPACE</div>
                  <h2>My watchlist<span className="heading-period">.</span></h2>
                </div>
              </div>

              {!user
                ? (
                  <div className="empty personal-empty">
                    <Bookmark size={22}/>
                    <b>Your anime list starts here.</b>
                    <span>Sign in to save shows and sync your list across devices.</span>
                    <button className="primary-btn" onClick={() => setAuthOpen(true)}>
                      Sign in to get started <ChevronRight size={16}/>
                    </button>
                  </div>
                )
                : watchlist.length
                  ? (
                    <div className="saved-list">
                      {watchlist.map(w => (
                        <div className="saved-item" key={w.anime_id}>
                          <img src={w.cover_image} alt=""/>
                          <span>{w.anime_title}</span>
                          <button onClick={() => toggleWatch({ id: w.anime_id })}>
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )
                  : <div className="empty">Your watchlist is empty. Save anime from any card to add it here.</div>
              }
            </section>
          </>
        )}
      </main>

      <footer>
        <a className="brand footer-brand" href="#">
          <span className="brand-mark">星</span>
          <span>HOSHI<span className="brand-light">NAMI</span></span>
        </a>
        <span>Made for the stories that stay with you.</span>
        <span className="footer-right">ANIME DISCOVERY BETA · 2026</span>
      </footer>

      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <div className="detail-modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelected(null)}>
              <X/>
            </button>

            <div
              className="detail-banner"
              style={{
                backgroundImage:
                  `linear-gradient(90deg,rgba(11,9,21,.95),rgba(11,9,21,.3)),url(${selected.bannerImage || selected.coverImage?.extraLarge})`
              }}
            ></div>

            <div className="detail-content">
              <div className="detail-cover">
                <img src={selected.coverImage?.large} alt=""/>
              </div>

              <div className="detail-info">
                <div className="eyebrow">ANIME DETAILS</div>
                <h2>{titleOf(selected)}</h2>

                <div className="detail-stats">
                  <span><Star size={14}/>{selected.averageScore ? `${selected.averageScore}%` : 'N/A'}</span>
                  <span>{selected.format || 'ANIME'}</span>
                  <span>{selected.seasonYear || '—'}</span>
                  <span>{selected.episodes || '?'} eps</span>
                </div>

                <p>{clean(selected.description)}</p>

                <div className="genre-list">
                  {(selected.genres || []).slice(0, 6).map(g => (
                    <span key={g}>{g}</span>
                  ))}
                </div>

                <button className="primary-btn save-large" onClick={() => toggleWatch(selected)}>
                  <Bookmark size={16}/>
                  {isSaved(selected) ? 'Remove from watchlist' : 'Add to watchlist'}
                </button>
              </div>
            </div>

            <div className="review-area">
              <div className="review-title">
                <h3>Community reviews</h3>
                <span>{reviews.filter(r => r.anime_id === selected.id).length} reviews</span>
              </div>

              {user
                ? (
                  <form className="review-form" onSubmit={submitReview}>
                    <select value={reviewScore} onChange={e => setReviewScore(e.target.value)}>
                      {[10,9,8,7,6,5,4,3,2,1].map(n => (
                        <option key={n} value={n}>{n}/10</option>
                      ))}
                    </select>
                    <input
                      value={reviewText}
                      onChange={e => setReviewText(e.target.value)}
                      placeholder="Share your thoughts…"
                      maxLength={500}
                    />
                    <button className="primary-btn">Post</button>
                  </form>
                )
                : <p className="muted">Sign in to write a review.</p>
              }

              {reviews
                .filter(r => r.anime_id === selected.id)
                .slice(0, 5)
                .map(r => (
                  <div className="review-card" key={r.id}>
                    <b>{r.score}/10</b>
                    <span>{r.body}</span>
                  </div>
                ))
              }
            </div>
          </div>
        </div>
      )}

      {authOpen && (
        <div
          className="modal-backdrop auth-backdrop"
          onClick={() => {
            setAuthOpen(false);
            setRecoveryMode(false);
          }}
        >
          <div className="auth-modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => {
              setAuthOpen(false);
              setRecoveryMode(false);
            }}>
              <X/>
            </button>

            <div className="brand auth-brand">
              <span className="brand-mark">星</span>
              <span>HOSHI<span className="brand-light">NAMI</span></span>
            </div>

            {recoveryMode ? (
              <>
                <div className="eyebrow">PASSWORD RECOVERY</div>
                <h2>Set a new password.</h2>
                <p className="muted">Choose a new password for your account.</p>

                <form className="auth-form" onSubmit={updatePassword}>
                  <label>New password</label>
                  <input
                    type="password"
                    required
                    minLength="6"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                  />
                  <button className="primary-btn full-btn">
                    Update password
                  </button>
                </form>
              </>
            ) : user ? (
              <>
                <h2>You're signed in.</h2>
                <p className="muted">{user.email}</p>
                <button className="primary-btn full-btn" onClick={signOut}>
                  <LogOut size={16}/> Sign out
                </button>
              </>
            ) : authMode === 'forgot' ? (
              <>
                <div className="eyebrow">ACCOUNT RECOVERY</div>
                <h2>Reset your password.</h2>
                <p className="muted">
                  Enter your registered email to receive a reset link.
                </p>

                <form className="auth-form" onSubmit={requestPasswordReset}>
                  <label>Email address</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                  <button className="primary-btn full-btn">
                    Send reset link
                  </button>
                </form>

                <button
                  className="switch-auth"
                  onClick={() => {
                    setAuthMode('signin');
                    setAuthMessage('');
                  }}
                >
                  Back to sign in
                </button>
              </>
            ) : (
              <>
                <div className="eyebrow">YOUR PERSONAL ANIME SPACE</div>
                <h2>{authMode === 'signin' ? 'Welcome back.' : 'Create your account.'}</h2>
                <p className="muted">Save your watchlist and share your reviews.</p>

                <form className="auth-form" onSubmit={authenticate}>
                  <label>Email address</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />

                  <label>Password</label>
                  <input
                    type="password"
                    required
                    minLength="6"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                  />

                  <button className="primary-btn full-btn">
                    {authMode === 'signin' ? 'Sign in' : 'Create account'}
                  </button>
                </form>

                {authMode === 'signin' && (
                  <button
                    className="switch-auth"
                    onClick={() => {
                      setAuthMode('forgot');
                      setAuthMessage('');
                    }}
                  >
                    Forgot Password?
                  </button>
                )}

                <button
                  className="switch-auth"
                  onClick={() => {
                    setAuthMode(authMode === 'signin' ? 'signup' : 'signin');
                    setAuthMessage('');
                  }}
                >
                  {authMode === 'signin'
                    ? 'New to HoshiNami? Create an account'
                    : 'Already registered? Sign in'}
                </button>
              </>
            )}

            {authMessage && <p className="auth-message">{authMessage}</p>}

            {!supabase && (
              <p className="setup-hint">
                Setup needed: configure your Supabase URL and publishable key.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AnimeGrid({ items, onSelect, onSave, isSaved }) {
  if (!items?.length) {
    return <div className="empty">No anime to show right now.</div>;
  }

  return (
    <div className="anime-grid">
      {items.map((a, i) => (
        <article
          className="anime-card"
          key={a.id}
          style={{ '--i': i }}
        >
          <button
            className="poster-button"
            onClick={() => onSelect(a)}
            aria-label={`View ${titleOf(a)}`}
          >
            <img
              src={a.coverImage?.extraLarge || a.coverImage?.large}
              loading="lazy"
              alt={titleOf(a)}
            />
            <span className="poster-overlay">
              <span><Play size={15} fill="currentColor"/> View details</span>
            </span>
          </button>

          <div className="card-info">
            <button className="card-title" onClick={() => onSelect(a)}>
              {titleOf(a)}
            </button>

            <div className="card-meta">
              <span>
                {a.format || 'ANIME'}
                {a.seasonYear ? ` · ${a.seasonYear}` : ''}
              </span>
              <span className="score">
                <Star size={12} fill="currentColor"/>
                {a.averageScore ? `${a.averageScore}%` : '—'}
              </span>
            </div>

            <button
              className={`save-btn ${isSaved(a) ? 'saved' : ''}`}
              onClick={() => onSave(a)}
            >
              <Bookmark
                size={14}
                fill={isSaved(a) ? 'currentColor' : 'none'}
              />
              {isSaved(a) ? 'Saved' : 'Add to list'}
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

export default App;
